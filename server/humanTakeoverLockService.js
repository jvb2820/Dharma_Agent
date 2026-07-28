import { createSupabaseServerClient } from './supabaseClient.js'

const DEFAULT_GRACE_MINUTES = 24 * 60

export function buildHumanTakeoverLock({
  contactId,
  assignee,
  phase = 'assigned',
  assignedAt = Date.now(),
  closedAt = 0,
} = {}) {
  if (!contactId || !assignee) return null

  const normalizedClosedAt = normalizeTimestamp(closedAt)
  const normalizedPhase = phase === 'cooldown' || normalizedClosedAt ? 'cooldown' : 'assigned'

  return {
    contactId: String(contactId),
    assignee: String(assignee),
    phase: normalizedPhase,
    assignedAt: normalizeTimestamp(assignedAt) || Date.now(),
    closedAt: normalizedPhase === 'cooldown' ? normalizedClosedAt || Date.now() : 0,
    lockedUntil:
      normalizedPhase === 'cooldown'
        ? (normalizedClosedAt || Date.now()) + getHumanTakeoverGraceMinutes() * 60 * 1000
        : 0,
    status: 'active',
  }
}

export function closeHumanTakeoverLock(lock, closedAt = Date.now()) {
  if (!lock?.contactId || !lock?.assignee) return null
  return buildHumanTakeoverLock({
    contactId: lock.contactId,
    assignee: lock.assignee,
    phase: 'cooldown',
    assignedAt: lock.assignedAt,
    closedAt,
  })
}

export function isHumanTakeoverLockActive(lock, now = Date.now()) {
  if (!lock || lock.status !== 'active') return false
  return lock.phase === 'assigned' || (lock.phase === 'cooldown' && Number(lock.lockedUntil) > now)
}

export function isHumanTakeoverLockExpired(lock, now = Date.now()) {
  return Boolean(
    lock &&
      lock.status === 'active' &&
      lock.phase === 'cooldown' &&
      Number(lock.lockedUntil) <= now,
  )
}

export async function saveHumanTakeoverLock(lock) {
  if (!lock) return null
  const supabase = createSupabaseServerClient()
  if (!supabase) return lock

  const { error } = await supabase.from('respond_human_takeover_locks').upsert({
    contact_id: lock.contactId,
    assignee: lock.assignee,
    phase: lock.phase,
    assigned_at: new Date(lock.assignedAt).toISOString(),
    closed_at: lock.closedAt ? new Date(lock.closedAt).toISOString() : null,
    locked_until: lock.lockedUntil ? new Date(lock.lockedUntil).toISOString() : null,
    status: 'active',
    updated_at: new Date().toISOString(),
    expired_at: null,
  })

  if (error) throw new Error(`Unable to save human-takeover lock: ${error.message}`)
  return lock
}

export async function getHumanTakeoverLock(contactId, fallback = null) {
  const supabase = createSupabaseServerClient()
  if (!supabase) return fallback

  const { data, error } = await supabase
    .from('respond_human_takeover_locks')
    .select('*')
    .eq('contact_id', String(contactId))
    .eq('status', 'active')
    .maybeSingle()

  if (error) {
    console.warn(`Unable to read human-takeover lock: ${error.message}`)
    return fallback
  }

  return data ? mapLockRow(data) : fallback
}

export async function expireHumanTakeoverLock(contactId, status = 'expired') {
  const supabase = createSupabaseServerClient()
  if (!supabase) return

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('respond_human_takeover_locks')
    .update({ status, expired_at: now, updated_at: now })
    .eq('contact_id', String(contactId))
    .eq('status', 'active')

  if (error) throw new Error(`Unable to expire human-takeover lock: ${error.message}`)
}

export function getHumanTakeoverGraceMinutes() {
  const value = Number(process.env.RESPOND_HUMAN_TAKEOVER_GRACE_MINUTES)
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_GRACE_MINUTES
}

function mapLockRow(row) {
  return {
    contactId: row.contact_id,
    assignee: row.assignee,
    phase: row.phase,
    assignedAt: normalizeTimestamp(row.assigned_at),
    closedAt: normalizeTimestamp(row.closed_at),
    lockedUntil: normalizeTimestamp(row.locked_until),
    status: row.status,
  }
}

function normalizeTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const timestamp = Date.parse(String(value || ''))
  return Number.isFinite(timestamp) ? timestamp : 0
}
