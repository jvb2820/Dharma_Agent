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
  const match = normalized.match(/\b(1[0-2]|0?[1-9])(?:[:.]\d{2})?\s*(am|pm)\b/)
  if (!match) return null
  let hour = Number(match[1])
  if (match[2] === 'pm' && hour < 12) hour += 12
  if (match[2] === 'am' && hour === 12) hour = 0
  return hour
}

const AVAILABILITY_MONTH_ALIASES = [
  ['january', 'jan', 'enero', 'janeiro'],
  ['february', 'feb', 'febrero', 'fevereiro'],
  ['march', 'mar', 'marzo', 'marco'],
  ['april', 'apr', 'abril'],
  ['may', 'mayo', 'maio'],
  ['june', 'jun', 'junio', 'junho'],
  ['july', 'jul', 'julio', 'julho'],
  ['august', 'aug', 'agosto'],
  ['september', 'sep', 'sept', 'septiembre', 'setembro'],
  ['october', 'oct', 'octubre', 'outubro'],
  ['november', 'nov', 'noviembre', 'novembro'],
  ['december', 'dec', 'diciembre', 'dezembro'],
]

export function extractAvailabilityMonth(value = '') {
  const normalized = String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

  if (!normalized) return null

  for (const [monthIndex, aliases] of AVAILABILITY_MONTH_ALIASES.entries()) {
    for (const alias of aliases) {
      if (!new RegExp(`\\b${alias}\\b`).test(normalized)) continue
      if (new RegExp(`\\b${alias}\\b\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`).test(normalized)) return null
      return { month: monthIndex + 1, name: AVAILABILITY_MONTH_ALIASES[monthIndex][0] }
    }
  }

  return null
}

export function extractPositiveDayPartConstraint(value = '') {
  const normalized = String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  const lead = '(?:only|just|available|free|can do|need|prefer|works for me|puedo|disponible|necesito|prefiero|solo|solamente|posso|disponivel|preciso|prefiro|apenas)'

  if (new RegExp(`\\b${lead}\\b[\\s\\S]{0,45}\\b(?:morning|manana|manha)\\b`).test(normalized)) {
    return { preferredTime: 'morning', earliestHour: 9, latestHour: 12, dayPart: 'morning' }
  }
  if (new RegExp(`\\b${lead}\\b[\\s\\S]{0,45}\\b(?:afternoon|tarde)\\b`).test(normalized)) {
    return { preferredTime: 'afternoon', earliestHour: 12, dayPart: 'afternoon' }
  }
  if (new RegExp(`\\b${lead}\\b[\\s\\S]{0,45}\\b(?:evening|night|noche|noite)\\b`).test(normalized)) {
    return { preferredTime: 'evening', earliestHour: 17, dayPart: 'evening' }
  }
  return null
}
