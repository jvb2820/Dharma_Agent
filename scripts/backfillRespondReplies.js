import { loadLocalEnv } from '../server/env.js'
import { createSupabaseServerClient } from '../server/supabaseClient.js'
import { buildPreview } from '../server/conversationReportService.js'

loadLocalEnv()

const RESPOND_API_BASE_URL = 'https://api.respond.io'
const DAY_MS = 24 * 60 * 60 * 1000
const days = Math.max(1, Number(getArgument('days') || 7))
const concurrency = Math.max(1, Math.min(20, Number(getArgument('concurrency') || 8)))
const fromTimestamp = Date.now() - days * DAY_MS
const fromIso = new Date(fromTimestamp).toISOString()
const token = process.env.RESPOND_API_TOKEN || process.env.RESPONDIO_API_KEY
const supabase = createSupabaseServerClient()

if (!token) throw new Error('RESPOND_API_TOKEN is not configured.')
if (!supabase) throw new Error('Supabase is not configured.')

const requestedLimit = Number(getArgument('limit') || 0)
const specifiedContacts = getArgument('contacts').split(',').map((value) => value.trim()).filter(Boolean)
const allContactIds = specifiedContacts.length > 0 ? specifiedContacts : await loadRecentContactIds(fromIso)
const contactIds = requestedLimit > 0 ? allContactIds.slice(0, requestedLimit) : allContactIds
let nextIndex = 0
let imported = 0
let failed = 0

console.log(`Backfilling ${contactIds.length} contacts since ${fromIso} with concurrency ${concurrency}.`)

await Promise.all(Array.from({ length: concurrency }, async () => {
  while (nextIndex < contactIds.length) {
    const index = nextIndex
    nextIndex += 1
    const contactId = contactIds[index]
    try {
      imported += await importContactReplies(contactId)
    } catch (error) {
      failed += 1
      console.warn(`[${index + 1}/${contactIds.length}] ${contactId}: ${error.message}`)
    }
    if ((index + 1) % 100 === 0) {
      console.log(`Processed ${index + 1}/${contactIds.length}; imported ${imported}; failed ${failed}.`)
    }
  }
}))

console.log(`Backfill complete. Imported ${imported} replies from ${contactIds.length} contacts; ${failed} contacts failed.`)
if (failed > 0) process.exitCode = 1

async function loadRecentContactIds(since) {
  const ids = new Set()
  const pageSize = 1000

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('respond_conversation_sessions')
      .select('contact_id')
      .gte('last_interaction_at', since)
      .order('last_interaction_at', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`Unable to list recent Respond contacts: ${error.message}`)
    for (const row of data || []) ids.add(String(row.contact_id))
    if (!data || data.length < pageSize) break
  }

  return [...ids]
}

async function importContactReplies(contactId) {
  let url = `${RESPOND_API_BASE_URL}/v2/contact/${encodeURIComponent(`id:${contactId}`)}/message/list?limit=100`
  let oldestTimestamp = Infinity
  let importedForContact = 0

  while (url && oldestTimestamp >= fromTimestamp) {
    const response = await fetchWithRetry(url)
    if (!response) break
    const payload = await response.json()
    const messages = Array.isArray(payload.items) ? payload.items : []
    if (messages.length === 0) break

    const rows = []
    for (const message of messages) {
      const timestamp = getMessageTimestamp(message)
      oldestTimestamp = Math.min(oldestTimestamp, timestamp)
      if (timestamp < fromTimestamp || message.traffic !== 'outgoing' || message.sender?.source !== 'api') continue
      if (message.status?.some((status) => status.value === 'failed')) continue

      rows.push({
        respond_contact_id: String(message.contactId || contactId),
        respond_message_id: String(message.messageId),
        channel_id: message.channelId ? String(message.channelId) : null,
        message_type: String(message.message?.type || 'message'),
        message_preview: buildPreview(getMessageText(message), message.message?.type),
        replied_at: new Date(timestamp).toISOString(),
      })
    }

    if (rows.length > 0) {
      const messageIds = rows.map((row) => row.respond_message_id)
      const { data: existing, error: readError } = await supabase
        .from('respond_reply_events')
        .select('respond_message_id')
        .in('respond_message_id', messageIds)
      if (readError) throw new Error(`Unable to check historical replies: ${readError.message}`)
      const existingIds = new Set((existing || []).map((row) => row.respond_message_id))
      const missingRows = rows.filter((row) => !existingIds.has(row.respond_message_id))
      if (missingRows.length === 0) {
        url = oldestTimestamp >= fromTimestamp ? payload.pagination?.next || '' : ''
        continue
      }
      const { error } = await supabase.from('respond_reply_events').insert(missingRows)
      if (error && missingRows.length > 1) {
        for (const missingRow of missingRows) {
          const { error: rowError } = await supabase.from('respond_reply_events').insert(missingRow)
          if (!rowError) importedForContact += 1
        }
      } else if (error) {
        throw new Error(`Unable to store historical reply: ${error.message}`)
      } else {
        importedForContact += missingRows.length
      }
    }

    url = oldestTimestamp >= fromTimestamp ? payload.pagination?.next || '' : ''
  }

  return importedForContact
}

async function fetchWithRetry(url, attempt = 1) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (response.ok) return response
  if (response.status === 404) return null
  if ((response.status === 429 || response.status >= 500) && attempt < 5) {
    const retryAfter = Number(response.headers.get('retry-after') || 0) * 1000
    await new Promise((resolve) => setTimeout(resolve, retryAfter || attempt * 1000))
    return fetchWithRetry(url, attempt + 1)
  }
  const body = await response.json().catch(() => ({}))
  throw new Error(body.message || `Respond message history failed with ${response.status}.`)
}

function getMessageTimestamp(message) {
  const messageId = Number(message?.messageId)
  return Number.isFinite(messageId) ? Math.floor(messageId / 1000) : 0
}

function getMessageText(message) {
  return message?.message?.text || message?.message?.attachment?.caption || ''
}

function getArgument(name) {
  const prefix = `--${name}=`
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || ''
}
