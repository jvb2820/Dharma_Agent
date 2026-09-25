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
  if (messageId) {
    const { data: existing, error: readError } = await supabase
      .from('respond_reply_events')
      .select('*')
      .eq('respond_message_id', messageId)
      .maybeSingle()
    if (readError) throw new Error(`Unable to check Respond reply: ${readError.message}`)
    if (existing) return existing
  }
  const query = supabase.from('respond_reply_events').insert(row)
  const { data, error } = await query.select().single()

  if (error) throw new Error(`Unable to record Respond reply: ${error.message}`)
  return data
}

export async function getConversationReport({ from, to } = {}) {
  const supabase = createSupabaseServerClient()
  if (!supabase) return {
    summary: { conversations: 0, replies: 0, averageReplies: 0 },
    analytics: buildConversationAnalytics([]),
    rows: [],
  }

  const range = getEasternReportRange({ from, to })
  const data = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase
      .from('respond_reply_events')
      .select('*')
      .order('replied_at', { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (range.from) query = query.gte('replied_at', range.from)
    if (range.toExclusive) query = query.lt('replied_at', range.toExclusive)
    const { data: page, error } = await query
    if (error) throw new Error(`Unable to load conversation report: ${error.message}`)
    data.push(...(page || []))
    if (!page || page.length < pageSize) break
  }

  const conversations = new Map()
  for (const event of data) {
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
  const analytics = buildConversationAnalytics(rows)
  return {
    summary: {
      conversations: rows.length,
      replies: data.length,
      averageReplies: rows.length ? Number((data.length / rows.length).toFixed(1)) : 0,
    },
    analytics,
    rows,
  }
}

export function buildConversationAnalytics(rows = []) {
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, conversations: 0 }))
  const channelCounts = new Map()

  for (const row of rows) {
    const hour = getEasternHour(row.first_replied_at)
    if (hour >= 0) hourly[hour].conversations += 1
    const channel = String(row.channel_id || 'Unknown')
    channelCounts.set(channel, (channelCounts.get(channel) || 0) + 1)
  }

  const byChannel = [...channelCounts.entries()]
    .map(([channelId, conversations]) => ({ channelId, conversations }))
    .sort((left, right) => right.conversations - left.conversations)

  return { hourly, byChannel }
}

function getEasternHour(value) {
  if (!value || Number.isNaN(Date.parse(value))) return -1
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(new Date(value))
  return Number(hour)
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
  const cleaned = [...String(text || '')]
    .map((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint < 32 || codePoint === 127 ? ' ' : character
    })
    .join('')
  const normalized = cleaned.replace(/\s+/g, ' ').trim()
  return (normalized || `[${messageType || 'message'}]`).slice(0, 240)
}
