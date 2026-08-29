import { createSupabaseServerClient } from './supabaseClient.js'

export async function recordBookingFailureEvent({
  contactId,
  attemptKey = '',
  failureType,
  phase,
  option = {},
  booking = {},
  error,
  metadata = {},
} = {}) {
  const supabase = createSupabaseServerClient()
  if (!supabase || !contactId || !failureType || !phase) return null

  const { data, error: writeError } = await supabase
    .from('booking_failure_events')
    .insert({
      respond_contact_id: String(contactId),
      attempt_key: clean(attemptKey) || buildAttemptKey(contactId, option),
      failure_type: String(failureType),
      failure_phase: String(phase),
      seller_slug: clean(option.sellerSlug),
      offered_start_at: toIso(option.startTime),
      booking_team: clean(option.bookingTeam || booking.bookingTeam),
      pending_field: clean(booking.pendingField),
      error_message: sanitizeError(error),
      metadata,
    })
    .select()
    .single()

  if (writeError) throw new Error(`Unable to record booking failure: ${writeError.message}`)
  return data
}

export function buildBookingAttemptKey(contactId, option = {}) {
  return buildAttemptKey(contactId, option)
}

function buildAttemptKey(contactId, option = {}) {
  const startTime = Number(option.startTime)
  const seller = clean(option.sellerSlug) || 'unknown'
  return `${String(contactId)}:${seller}:${Number.isFinite(startTime) ? startTime : 'unknown'}`
}

function sanitizeError(error) {
  return String(error?.message || error || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4,}/g, '[phone]')
    .slice(0, 1000) || null
}

function clean(value) {
  const result = String(value || '').trim()
  return result || null
}

function toIso(value) {
  const date = new Date(Number(value) || value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
