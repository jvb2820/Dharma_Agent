const DEFAULT_RECHECK_DELAY_MS = 2500
const DEFAULT_RECHECK_ATTEMPTS = 3

export async function recheckRespondAssignment({
  initialProfile,
  isAssigned,
  loadProfile,
  normalizeProfile = (profile) => profile,
  delay = wait,
  delayMs = getRespondAssignmentRecheckDelayMs(),
  attempts = getRespondAssignmentRecheckAttempts(),
} = {}) {
  let profile = initialProfile

  if (typeof isAssigned !== 'function' || !isAssigned(profile)) {
    return { profile, rechecked: false, released: false, attempts: 0 }
  }

  if (typeof loadProfile !== 'function') {
    throw new Error('loadProfile is required to recheck a Respond assignment.')
  }

  const boundedAttempts = Math.max(1, Math.min(Number(attempts) || 1, 5))
  const boundedDelayMs = Math.max(0, Math.min(Number(delayMs) || 0, 10_000))

  for (let attempt = 1; attempt <= boundedAttempts; attempt += 1) {
    if (boundedDelayMs > 0) await delay(boundedDelayMs)

    profile = normalizeProfile(await loadProfile(profile))

    if (!isAssigned(profile)) {
      return { profile, rechecked: true, released: true, attempts: attempt }
    }
  }

  return {
    profile,
    rechecked: true,
    released: false,
    attempts: boundedAttempts,
  }
}

export function getRespondAssignmentRecheckDelayMs() {
  const value = Number(process.env.RESPOND_ASSIGNMENT_RECHECK_DELAY_MS)
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_RECHECK_DELAY_MS
}

export function getRespondAssignmentRecheckAttempts() {
  const value = Number(process.env.RESPOND_ASSIGNMENT_RECHECK_ATTEMPTS)
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_RECHECK_ATTEMPTS
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
