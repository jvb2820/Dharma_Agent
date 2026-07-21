import { createSupabaseServerClient } from './supabaseClient.js'

const DEFAULT_GRACE_MINUTES = 60

export function buildPostBookingLock({ contactId, assignee, booked = {}, option = {}, now = Date.now() } = {}) {
  const meetingStartAt = normalizeTimestamp(option.startTime || booked.startTime)
  const meetingEndAt = normalizeTimestamp(
    option.endTime || booked.endTime || (meetingStartAt ? meetingStartAt + Number(option.duration || 20 * 60 * 1000) : 0),
  )

  if (!contactId || !assignee || !meetingStartAt || !meetingEndAt) return null

  const graceMinutes = getPostBookingGraceMinutes()
  return {
    contactId: String(contactId),
    bookingId: String(booked.calendarEventId || booked.id || ''),
    assignee: String(assignee),
    meetingStartAt,
    meetingEndAt,
    lockedUntil: meetingEndAt + graceMinutes * 60 * 1000,
    status: 'active',
    createdAt: now,
  }
}

export function isPostBookingLockActive(lock, now = Date.now()) {
  return Boolean(lock && lock.status === 'active' && Number(lock.lockedUntil) > now)
}

export function isPostBookingLockExpired(lock, now = Date.now()) {
  return Boolean(lock && lock.status === 'active' && Number(lock.lockedUntil) <= now)
}

export async function savePostBookingLock(lock) {
  if (!lock) return null
  const supabase = createSupabaseServerClient()
  if (!supabase) return lock

  const { error } = await supabase.from('respond_post_booking_locks').upsert({
    contact_id: lock.contactId,
    booking_id: lock.bookingId || null,
    assignee: lock.assignee,
    meeting_start_at: new Date(lock.meetingStartAt).toISOString(),
    meeting_end_at: new Date(lock.meetingEndAt).toISOString(),
    locked_until: new Date(lock.lockedUntil).toISOString(),
    status: 'active',
    updated_at: new Date().toISOString(),
    expired_at: null,
  })

  if (error) throw new Error(`Unable to save post-booking lock: ${error.message}`)
  return lock
}

export async function getPostBookingLock(contactId, fallback = null) {
  const supabase = createSupabaseServerClient()
  if (!supabase) return fallback

  const { data, error } = await supabase
    .from('respond_post_booking_locks')
    .select('*')
    .eq('contact_id', String(contactId))
    .eq('status', 'active')
    .maybeSingle()

  if (error) {
    console.warn(`Unable to read post-booking lock: ${error.message}`)
    return fallback
  }

  return data ? mapLockRow(data) : fallback
}

export async function expirePostBookingLock(contactId) {
  const supabase = createSupabaseServerClient()
  if (!supabase) return

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('respond_post_booking_locks')
    .update({ status: 'expired', expired_at: now, updated_at: now })
    .eq('contact_id', String(contactId))
    .eq('status', 'active')

  if (error) throw new Error(`Unable to expire post-booking lock: ${error.message}`)
}

export function getPostBookingGraceMinutes() {
  const value = Number(process.env.RESPOND_POST_BOOKING_GRACE_MINUTES)
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_GRACE_MINUTES
}

function mapLockRow(row) {
  return {
    contactId: row.contact_id,
    bookingId: row.booking_id || '',
    assignee: row.assignee,
    meetingStartAt: normalizeTimestamp(row.meeting_start_at),
    meetingEndAt: normalizeTimestamp(row.meeting_end_at),
    lockedUntil: normalizeTimestamp(row.locked_until),
    status: row.status,
    createdAt: normalizeTimestamp(row.created_at),
  }
}

function normalizeTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const timestamp = Date.parse(String(value || ''))
  return Number.isFinite(timestamp) ? timestamp : 0
}
