export function applyDefaultAvailabilityRule(details = {}, preferredTime = '') {
  const nextDetails = { ...details }

  if (nextDetails.direction === 'earlier' || nextDetails.allowBeforeDefaultStart) {
    if (nextDetails.direction === 'earlier') delete nextDetails.earliestHour
    return nextDetails
  }

  if (!Number.isInteger(nextDetails.earliestHour)) {
    const exactHour = extractClockHour(preferredTime || nextDetails.preferredTime)
    nextDetails.earliestHour = exactHour == null ? 9 : exactHour
    if (exactHour != null && exactHour < 9) nextDetails.allowBeforeDefaultStart = true
  }

  return nextDetails
}

export function extractClockHour(value = '') {
  const normalized = String(value).toLowerCase()
  const match = normalized.match(/\b(1[0-2]|0?[1-9])(?::\d{2})?\s*(am|pm)\b/)
  if (!match) return null
  let hour = Number(match[1])
  if (match[2] === 'pm' && hour < 12) hour += 12
  if (match[2] === 'am' && hour === 12) hour = 0
  return hour
}
