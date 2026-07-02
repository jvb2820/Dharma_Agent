const FLORIDA_TIMEZONE = 'America/New_York'

const BOOKING_SPECIALIST_NAMES = {
  sales: {
    meribet: 'MERIBET',
    'meribet sampson': 'MERIBET',
    leo: 'LEONARDO',
    leonardo: 'LEONARDO',
    'leonardo goncales': 'LEONARDO',
    'leonardo goncalves': 'LEONARDO',
    'lgoncalves2': 'LEONARDO',
    'maria claudia': 'MARIA CLAUDIA',
    andres: 'ANDRES',
    'andres castro': 'ANDRES',
    alejandro: 'ALEJANDRO',
    'alejandro rivera': 'ALEJANDRO',
    diana: 'DIANA',
    'diana stephanie': 'DIANA',
    'diana villalobos': 'DIANA',
  },
  customer_service: {
    alice: 'ALICE',
    'alice f': 'ALICE',
    brayam: 'BRAYAM',
    'brayam zuluaga': 'BRAYAM',
    arles: 'ARLES',
    'arles martinez': 'ARLES',
    edmilson: 'EDMILSON',
    'edmilson morales': 'EDMILSON',
    'maria roa': 'MARIA ROA',
  },
}

export const AIRCALL_MEMBER_NUMBERS = {
  MERIBET: '+1 754-354-6333',
  LEONARDO: '+1 561-287-8998',
  'MARIA CLAUDIA': '+1 561-609-1984',
  ANDRES: '+1 561-464-4507',
  ALEJANDRO: '+1 561-571-8960',
  DIANA: '+1 561-765-4952',
  ARLES: '+1 561-418-7283',
  BRAYAM: '+1 561-288-5026',
  EDMILSON: '+1 561-571-9639',
}

export function buildBookedMessage({ bookingTeam, option, booked, customer = {} }) {
  const scheduledAt = option?.startTime || booked?.startTime
  const timezone = option?.timezone || FLORIDA_TIMEZONE
  const specialistName = resolveBookedSpecialistName({ bookingTeam, option, booked })
  const phone = formatPhoneForBookedMessage(
    AIRCALL_MEMBER_NUMBERS[specialistName] || customer.phone,
  )

  return [
    `📲 Your call is scheduled for ${formatBookedDate(scheduledAt, timezone)} AT ${formatBookedTime(
      scheduledAt,
      timezone,
    )} with ${specialistName}🥰.`,
    '',
    `📞 Our Dharma's expert will reach out to you via regular phone call at ${phone}.`,
    '',
    "⏰ Remember it's EST Time.",
    '',
    "⚠️*To secure your discount, ensure availability for your initial evaluation call. Our schedule fills quickly; rescheduling on the same day is not guaranteed if the call is missed.*",
  ].join('\n')
}

function resolveBookedSpecialistName({ bookingTeam, option, booked }) {
  const team = bookingTeam === 'customer_service' ? 'customer_service' : 'sales'
  const names = BOOKING_SPECIALIST_NAMES[team]
  const candidates = [
    booked?.sellerFieldValue,
    option?.sellerFieldValue,
    booked?.sellerName,
    option?.sellerName,
    booked?.sellerSlug,
    option?.sellerSlug,
  ].filter(Boolean)

  for (const candidate of candidates) {
    const normalized = normalizeNameKey(candidate)

    if (names[normalized]) {
      return names[normalized]
    }
  }

  return String(booked?.sellerName || option?.sellerName || 'DHARMA').toUpperCase()
}

function formatBookedDate(timestamp, timezone) {
  if (!timestamp) {
    return ''
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: timezone,
  })
    .format(new Date(timestamp))
    .replace(', ', ',')
}

function formatBookedTime(timestamp, timezone) {
  if (!timestamp) {
    return ''
  }

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  }).format(new Date(timestamp))
}

function formatPhoneForBookedMessage(phone) {
  const rawPhone = String(phone || '').trim()
  const digits = rawPhone.replace(/\D/g, '')

  if (digits.length === 10) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return `${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
  }

  return rawPhone
}

function normalizeNameKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
