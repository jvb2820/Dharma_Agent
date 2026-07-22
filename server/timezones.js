const DEFAULT_TIMEZONE = 'America/New_York'

const STATE_TIME_ZONES = {
  Alabama: 'America/Chicago',
  Alaska: 'America/Anchorage',
  Arizona: 'America/Phoenix',
  Arkansas: 'America/Chicago',
  California: 'America/Los_Angeles',
  Colorado: 'America/Denver',
  Connecticut: 'America/New_York',
  Delaware: 'America/New_York',
  'District of Columbia': 'America/New_York',
  Florida: 'America/New_York',
  Georgia: 'America/New_York',
  Hawaii: 'Pacific/Honolulu',
  Idaho: 'America/Boise',
  Illinois: 'America/Chicago',
  Indiana: 'America/Indiana/Indianapolis',
  Iowa: 'America/Chicago',
  Kansas: 'America/Chicago',
  Kentucky: 'America/New_York',
  Louisiana: 'America/Chicago',
  Maine: 'America/New_York',
  Maryland: 'America/New_York',
  Massachusetts: 'America/New_York',
  Michigan: 'America/Detroit',
  Minnesota: 'America/Chicago',
  Mississippi: 'America/Chicago',
  Missouri: 'America/Chicago',
  Montana: 'America/Denver',
  Nebraska: 'America/Chicago',
  Nevada: 'America/Los_Angeles',
  'New Hampshire': 'America/New_York',
  'New Jersey': 'America/New_York',
  'New Mexico': 'America/Denver',
  'New York': 'America/New_York',
  'North Carolina': 'America/New_York',
  'North Dakota': 'America/Chicago',
  Ohio: 'America/New_York',
  Oklahoma: 'America/Chicago',
  Oregon: 'America/Los_Angeles',
  Pennsylvania: 'America/New_York',
  'Puerto Rico': 'America/Puerto_Rico',
  'Rhode Island': 'America/New_York',
  'South Carolina': 'America/New_York',
  'South Dakota': 'America/Chicago',
  Tennessee: 'America/Chicago',
  Texas: 'America/Chicago',
  Utah: 'America/Denver',
  Vermont: 'America/New_York',
  Virginia: 'America/New_York',
  Washington: 'America/Los_Angeles',
  'West Virginia': 'America/New_York',
  Wisconsin: 'America/Chicago',
  Wyoming: 'America/Denver',
}

export function getStateTimeZone(state, fallbackTimezone = DEFAULT_TIMEZONE) {
  return STATE_TIME_ZONES[normalizeStateName(state)] || fallbackTimezone || DEFAULT_TIMEZONE
}

export function getStateTimeLabel(state, fallbackLabel = 'Eastern Time', language = '') {
  const normalizedState = normalizeStateName(state)
  const locale = getBookingLocale(language)
  const stateLabel = STATE_TIME_ZONES[normalizedState] ? normalizedState : fallbackLabel.replace(/\s+Time$/i, '')

  if (locale === 'es-US') return `Hora de ${stateLabel}`
  if (locale === 'pt-BR') return `Horário de ${stateLabel}`
  return STATE_TIME_ZONES[normalizedState] ? `${normalizedState} Time` : fallbackLabel
}

export function formatCustomerStateSlot(timestamp, state, fallbackTimezone = DEFAULT_TIMEZONE, language = '') {
  if (!timestamp) {
    return ''
  }

  const timezone = getStateTimeZone(state, fallbackTimezone)
  const locale = getBookingLocale(language)
  const label = getStateTimeLabel(state, 'Eastern Time', language)
  const formatted = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(timestamp))

  return `${capitalizeFirst(formatted)} ${label}`
}

export function formatCustomerStateDate(timestamp, state, fallbackTimezone = DEFAULT_TIMEZONE) {
  if (!timestamp) {
    return ''
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: getStateTimeZone(state, fallbackTimezone),
  })
    .format(new Date(timestamp))
    .replace(', ', ',')
}

export function formatCustomerStateTime(timestamp, state, fallbackTimezone = DEFAULT_TIMEZONE) {
  if (!timestamp) {
    return ''
  }

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: getStateTimeZone(state, fallbackTimezone),
  }).format(new Date(timestamp))
}

export function getCustomerStateHour(timestamp, state, fallbackTimezone = DEFAULT_TIMEZONE) {
  if (!timestamp) {
    return null
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone: getStateTimeZone(state, fallbackTimezone),
  }).formatToParts(new Date(timestamp))

  return Number(parts.find((part) => part.type === 'hour')?.value ?? NaN)
}

function normalizeStateName(state) {
  return String(state || '').trim()
}

function getBookingLocale(language) {
  const normalized = String(language || '').toLowerCase()
  if (normalized.includes('spanish') || normalized.startsWith('es') || normalized.includes('español')) return 'es-US'
  if (normalized.includes('portuguese') || normalized.startsWith('pt') || normalized.includes('português')) return 'pt-BR'
  return 'en-US'
}

function capitalizeFirst(value) {
  const text = String(value || '')
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : text
}
