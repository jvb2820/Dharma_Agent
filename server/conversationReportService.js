import { getEasternReportRange } from './bookingReportService.js'
import { createSupabaseServerClient } from './supabaseClient.js'

export async function recordRespondReply({ contactId, channelId, messageType = 'text', text = '', response = {} }) {
  const supabase = createSupabaseServerClient()
  if (!supabase || !contactId) return null

  const messageId = getRespondMessageId(response)
  const row = {
    respond_contact_id: String(contactId),
    respond_message_id: messageId || null,
    channel_id: channelId ? String(channelId) : null,
    message_type: String(messageType || 'text'),
    message_preview: buildPreview(text, messageType),
    replied_at: new Date().toISOString(),
  }
  const query = messageId
    ? supabase.from('respond_reply_events').upsert(row, { onConflict: 'respond_message_id' })
    : supabase.from('respond_reply_events').insert(row)
  const { data, error } = await query.select().single()

  if (error) throw new Error(`Unable to record Respond reply: ${error.message}`)
  return data
}

export async function getConversationReport({ from, to } = {}) {
  const supabase = createSupabaseServerClient()
  if (!supabase) return { summary: { conversations: 0, replies: 0 }, rows: [] }

  const range = getEasternReportRange({ from, to })
  let query = supabase
    .from('respond_reply_events')
    .select('*')
    .order('replied_at', { ascending: false })
    .limit(5000)

  if (range.from) query = query.gte('replied_at', range.from)
  if (range.toExclusive) query = query.lt('replied_at', range.toExclusive)

  const { data, error } = await query
  if (error) throw new Error(`Unable to load conversation report: ${error.message}`)

  const conversations = new Map()
  for (const event of data || []) {
    const existing = conversations.get(event.respond_contact_id)
    if (existing) {
      existing.reply_count += 1
      existing.first_replied_at = event.replied_at
      continue
    }
    conversations.set(event.respond_contact_id, {
      respond_contact_id: event.respond_contact_id,
      conversation_url: buildRespondConversationUrl(event.respond_contact_id),
      channel_id: event.channel_id,
      first_replied_at: event.replied_at,
      last_replied_at: event.replied_at,
      reply_count: 1,
      latest_message_type: event.message_type,
      latest_message_preview: event.message_preview,
    })
  }

  const rows = [...conversations.values()]
  return {
    summary: { conversations: rows.length, replies: (data || []).length },
    rows,
  }
}

export function buildRespondConversationUrl(contactId, spaceId = process.env.RESPOND_SPACE_ID || '238284') {
  const contact = String(contactId || '').trim()
  const space = String(spaceId || '').trim()
  if (!contact || !space) return ''
  return `https://app.respond.io/space/${encodeURIComponent(space)}/inbox/${encodeURIComponent(contact)}`
}

export function getRespondMessageId(response = {}) {
  return String(
    response.messageId || response.message_id || response.id ||
    response.data?.messageId || response.data?.message_id || response.data?.id || '',
  ).trim()
}

export function buildPreview(text = '', messageType = 'text') {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  return (normalized || `[${messageType || 'message'}]`).slice(0, 240)
}
