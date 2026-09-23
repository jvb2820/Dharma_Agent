import { randomUUID } from 'node:crypto'
import { createSupabaseServerClient } from './supabaseClient.js'
import { buildBookingAttemptKey } from './bookingFailureService.js'

const TRANSIENT_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504])

export async function executeIdempotentBooking({
  contactId,
  option,
  reconcile,
  submit,
} = {}) {
  const attemptKey = buildBookingAttemptKey(contactId, option)
  const owner = randomUUID()
  const attempt = await acquireAttempt({ attemptKey, contactId, option, owner }).catch((error) => {
    console.warn(`[booking-idempotency-fallback] ${error.message}`)
    return null
  })

  if (attempt?.status === 'confirmed' && attempt.booked_result) {
    return { booked: attempt.booked_result, attemptKey, reused: true }
  }

  if (attempt && attempt.lease_owner !== owner) {
    const settled = await waitForAttempt(attemptKey)
    if (settled?.status === 'confirmed' && settled.booked_result) {
      return { booked: settled.booked_result, attemptKey, reused: true }
    }
    const error = new Error('This appointment is already being processed. Please wait a moment.')
    error.status = 409
    error.category = 'booking_in_progress'
    throw error
  }

  try {
    const existing = await reconcile().catch((error) => {
      console.warn(`[booking-pre-submit-reconciliation] ${error.message}`)
      return null
    })
    const booked = existing || await submit()
    await markAttemptConfirmed(attemptKey, booked).catch((error) => {
      console.warn(`[booking-idempotency-confirm-write] ${error.message}`)
    })
    return { booked, attemptKey, reused: Boolean(existing) }
  } catch (error) {
    await markAttemptFailed(attemptKey, error).catch((writeError) => {
      console.warn(`[booking-idempotency-failure-write] ${writeError.message}`)
    })
    throw error
  }
}

export async function enqueueBookingReconciliation({ attemptKey, contactId, payload } = {}) {
  const supabase = createSupabaseServerClient()
  if (!supabase || !attemptKey || !contactId) return null
  const { data, error } = await supabase.from('booking_reconciliation_jobs').upsert({
    attempt_key: attemptKey,
    respond_contact_id: String(contactId),
    payload,
    status: 'pending',
    next_attempt_at: new Date().toISOString(),
    lease_owner: null,
    lease_expires_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'attempt_key' }).select().single()
  if (error) throw new Error(`Unable to queue booking reconciliation: ${error.message}`)
  return data
}

export async function runOneBookingReconciliation({ handler, workerId = randomUUID() } = {}) {
  const supabase = createSupabaseServerClient()
  if (!supabase || typeof handler !== 'function') return null
  const { data, error } = await supabase.rpc('claim_booking_reconciliation_job', {
    worker_id: workerId,
    lease_seconds: 120,
  })
  if (error) {
    if (isMissingReliabilitySchema(error)) return null
    throw new Error(`Unable to claim booking reconciliation: ${error.message}`)
  }
  const job = data?.[0]
  if (!job) return null
  try {
    await handler(job)
    await supabase.from('booking_reconciliation_jobs').update({
      status: 'completed', completed_at: new Date().toISOString(),
      lease_owner: null, lease_expires_at: null, last_error: null, updated_at: new Date().toISOString(),
    }).eq('id', job.id).eq('lease_owner', workerId)
    return { completed: true, job }
  } catch (jobError) {
    const attempts = Number(job.attempts || 1)
    const retryable = isTransientBookingError(jobError) && attempts < 6
    const delayMinutes = Math.min(30, 2 ** Math.max(0, attempts - 1))
    await supabase.from('booking_reconciliation_jobs').update({
      status: retryable ? 'pending' : 'failed',
      next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
      lease_owner: null, lease_expires_at: null,
      last_error: sanitizeError(jobError), updated_at: new Date().toISOString(),
    }).eq('id', job.id).eq('lease_owner', workerId)
    return { completed: false, retryable, job, error: jobError }
  }
}

export function isTransientBookingError(error) {
  const status = Number(error?.status || error?.statusCode || 0)
  return TRANSIENT_STATUS.has(status) || /timeout|timed out|network|fetch failed|temporar|rate limit|ECONN|socket/i.test(String(error?.message || error))
}

async function acquireAttempt({ attemptKey, contactId, option, owner }) {
  const supabase = createSupabaseServerClient()
  if (!supabase) return null
  const { data, error } = await supabase.rpc('acquire_booking_attempt', {
    claim_attempt_key: attemptKey,
    claim_contact_id: String(contactId),
    claim_seller_slug: String(option?.sellerSlug || ''),
    claim_start_at: new Date(Number(option?.startTime)).toISOString(),
    claim_owner: owner,
    claim_lease_seconds: 120,
  })
  if (error) throw new Error(`Unable to acquire booking attempt: ${error.message}`)
  return Array.isArray(data) ? data[0] : data
}

async function waitForAttempt(attemptKey) {
  const supabase = createSupabaseServerClient()
  if (!supabase) return null
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    const { data } = await supabase.from('booking_attempts').select('*').eq('attempt_key', attemptKey).maybeSingle()
    if (data?.status !== 'processing') return data
  }
  return null
}

async function markAttemptConfirmed(attemptKey, booked) {
  const supabase = createSupabaseServerClient()
  if (!supabase) return
  const { error } = await supabase.from('booking_attempts').update({
    status: 'confirmed', booked_result: booked, last_error: null,
    lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString(),
  }).eq('attempt_key', attemptKey)
  if (error && !isMissingReliabilitySchema(error)) throw error
}

async function markAttemptFailed(attemptKey, errorValue) {
  const supabase = createSupabaseServerClient()
  if (!supabase) return
  const { error } = await supabase.from('booking_attempts').update({
    status: 'failed', last_error: sanitizeError(errorValue),
    lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString(),
  }).eq('attempt_key', attemptKey)
  if (error && !isMissingReliabilitySchema(error)) throw error
}

function sanitizeError(error) {
  return String(error?.message || error || '').slice(0, 1000)
}

function isMissingReliabilitySchema(error) {
  return /booking_attempts|booking_reconciliation_jobs|acquire_booking_attempt|claim_booking_reconciliation_job|schema cache|does not exist/i.test(String(error?.message || error))
}
