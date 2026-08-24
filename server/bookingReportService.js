import { createSupabaseServerClient } from './supabaseClient.js'

export async function recordBookingReportEvent({ contactId, contactPhone, attribution = {}, booked = {}, option = {} }) {
  const supabase = createSupabaseServerClient()
  if (!supabase || !contactId) return null

  const bookedAt = new Date().toISOString()
  const meetingStartAt = toIso(booked.startTime || booked.start_at || option.startTime)
  const externalBookingId = String(booked.id || booked.meetingId || booked.eventId || '').trim()
  const bookingKey = externalBookingId || `${contactId}:${meetingStartAt || bookedAt.slice(0, 16)}`
  const source = normalizeSource(attribution)
  const { data, error } = await supabase
    .from('booking_attribution_events')
    .upsert({
      respond_contact_id: String(contactId),
      booking_key: bookingKey,
      external_booking_id: externalBookingId || null,
      booked_at: bookedAt,
      meeting_start_at: meetingStartAt,
      source_platform: source.platform,
      source_type: source.type,
      campaign_id: clean(attribution.campaignId),
      campaign_name: clean(attribution.campaignName),
      ad_id: clean(attribution.adId),
      ad_name: clean(attribution.adName),
      ad_url: clean(attribution.adUrl),
      attribution_data: {
        ...attribution,
        contactPhone: normalizePhoneDigits(contactPhone),
      },
    }, { onConflict: 'booking_key' })
    .select()
    .single()

  if (error) throw new Error(`Unable to record booking attribution: ${error.message}`)
  return data
}

export async function getBookingReport({ from, to } = {}) {
  const supabase = createSupabaseServerClient()
  if (!supabase) return { summary: emptySummary(), rows: [] }

  let query = supabase
    .from('booking_attribution_events')
    .select('*')
    .order('booked_at', { ascending: false })
    .limit(1000)

  if (from) query = query.gte('booked_at', `${from}T00:00:00.000Z`)
  if (to) query = query.lte('booked_at', `${to}T23:59:59.999Z`)

  const { data, error } = await query
  if (error) throw new Error(`Unable to load booking report: ${error.message}`)
  const rows = (data || []).map((row) => ({
    ...(row.source_type === 'paid_ad'
      ? row
      : { ...row, source_platform: 'organic', source_type: 'organic' }),
    contact_phone: normalizePhoneDigits(row.attribution_data?.contactPhone),
  }))
  const summary = emptySummary()

  for (const row of rows) {
    summary.total += 1
    const platform = row.source_platform || 'unknown'
    summary.byPlatform[platform] = (summary.byPlatform[platform] || 0) + 1
    if (row.source_type === 'paid_ad') summary.fromAds += 1
  }

  return { summary, rows }
}

export async function updateContactBookingAttribution({ contactId, attribution = {} }) {
  const supabase = createSupabaseServerClient()
  if (!supabase || !contactId) return []
  const source = normalizeSource(attribution)
  const update = {
    source_platform: source.platform,
    source_type: source.type,
    campaign_id: clean(attribution.campaignId),
    campaign_name: clean(attribution.campaignName),
    ad_id: clean(attribution.adId),
    ad_name: clean(attribution.adName),
    ad_url: clean(attribution.adUrl),
  }
  const { data: existingRows, error: readError } = await supabase
    .from('booking_attribution_events')
    .select('id, attribution_data')
    .eq('respond_contact_id', String(contactId))
  if (readError) throw new Error(`Unable to load booking attribution: ${readError.message}`)

  const updated = []
  for (const row of existingRows || []) {
    const { data, error } = await supabase
      .from('booking_attribution_events')
      .update({ ...update, attribution_data: { ...(row.attribution_data || {}), ...attribution } })
      .eq('id', row.id)
      .select('id')
      .single()
    if (error) throw new Error(`Unable to update booking attribution: ${error.message}`)
    updated.push(data)
  }
  return updated
}

export function applyContactLeadSourceAttribution(attribution = {}, leadSource = '') {
  const normalized = String(leadSource || '').trim().toLowerCase()
  const platform = /\b(meta|facebook|instagram|fb)\b/.test(normalized)
    ? 'meta'
    : /\b(tiktok|tik[ -]?tok)\b/.test(normalized)
      ? 'tiktok'
      : 'organic'

  if (platform === 'organic') {
    return { platform: 'organic', type: 'organic', source: leadSource || 'Organic' }
  }

  return {
    ...attribution,
    platform,
    type: 'paid_ad',
    source: leadSource,
  }
}

function normalizeSource(value = {}) {
  const text = [value.platform, value.source, value.type, value.adUrl].filter(Boolean).join(' ').toLowerCase()
  const isPaidAd = Boolean(value.adId || value.adUrl || /\bpaid_ad\b|\bad\b|paid|sponsored|click.to.chat/.test(text))
  if (!isPaidAd) return { platform: 'organic', type: 'organic' }

  const platform = /facebook|instagram|meta|fb/.test(text)
    ? 'meta'
    : /tiktok|ttclid/.test(text)
      ? 'tiktok'
      : 'other'
  return { platform, type: 'paid_ad' }
}

function emptySummary() {
  return { total: 0, fromAds: 0, byPlatform: {} }
}

function clean(value) {
  const result = String(value || '').trim()
  return result || null
}

function toIso(value) {
  if (!value) return null
  const date = new Date(Number(value) || value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizePhoneDigits(value) {
  return String(value || '').replace(/\D/g, '')
}
