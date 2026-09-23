import { createSupabaseServerClient } from './supabaseClient.js'
import { buildBookingAttemptKey } from './bookingFailureService.js'

export async function recordBookingFunnelEvent({ contactId, eventType, option = {}, booking = {}, metadata = {} } = {}) {
  const supabase = createSupabaseServerClient()
  if (!supabase || !contactId || !eventType) return null
  const hasOption = option?.sellerSlug && Number.isFinite(Number(option?.startTime))
  const attemptKey = hasOption ? buildBookingAttemptKey(contactId, option) : null
  const eventKey = `${String(contactId)}:${String(eventType)}:${attemptKey || metadata.stageKey || 'general'}`
  const { data, error } = await supabase.from('booking_funnel_events').upsert({
    event_key: eventKey,
    respond_contact_id: String(contactId),
    event_type: String(eventType),
    attempt_key: attemptKey,
    seller_slug: clean(option.sellerSlug),
    appointment_start_at: toIso(option.startTime),
    booking_team: clean(option.bookingTeam || booking.bookingTeam),
    metadata,
  }, { onConflict: 'event_key', ignoreDuplicates: true }).select().maybeSingle()
  if (error) {
    if (/booking_funnel_events|schema cache|does not exist/i.test(error.message)) return null
    throw new Error(`Unable to record booking funnel event: ${error.message}`)
  }
  return data
}

function clean(value) {
  const result = String(value || '').trim()
  return result || null
}

function toIso(value) {
  const date = new Date(Number(value) || value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
