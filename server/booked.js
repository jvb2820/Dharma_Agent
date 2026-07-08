import {
  formatCustomerStateDate,
  formatCustomerStateTime,
  getStateTimeLabel,
  getStateTimeZone,
} from './timezones.js'

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

export function buildBookedMessage({ bookingTeam, option, booked, customer = {}, language = '' }) {
  const scheduledAt = option?.startTime || booked?.startTime
  const timezone = getStateTimeZone(customer.state, option?.timezone || FLORIDA_TIMEZONE)
  const timeLabel = getStateTimeLabel(customer.state)
  const specialistName = resolveBookedSpecialistName({ bookingTeam, option, booked })
  const phone = formatPhoneForBookedMessage(
    AIRCALL_MEMBER_NUMBERS[specialistName] || customer.phone,
  )
  const languageName = normalizeBookedLanguageName(language || customer.preferredLanguage)
  const displayDate = formatBookedDate(scheduledAt, customer.state, timezone, languageName)
  const displayTime = formatCustomerStateTime(scheduledAt, customer.state, timezone)
  const localizedTimeLabel = formatBookedTimeLabel(customer.state, timeLabel, languageName)

  if (languageName === 'Latin American Spanish') {
    return [
      `📲 Tu llamada quedo agendada para ${displayDate} A LAS ${displayTime} con ${specialistName}🥰.`,
      '',
      `📞 El especialista de Dharma te llamara por llamada regular al ${phone}.`,
      '',
      `⏰ Recuerda que es hora de ${localizedTimeLabel}.`,
      '',
      '⚠️*Para asegurar tu descuento, confirma tu disponibilidad para la llamada inicial de evaluacion. Nuestra agenda se llena rapido; si pierdes la llamada, no se garantiza reagendar el mismo dia.*',
    ].join('\n')
  }

  if (languageName === 'Portuguese') {
    return [
      `📲 Sua chamada esta agendada para ${displayDate} AS ${displayTime} com ${specialistName}🥰.`,
      '',
      `📞 O especialista da Dharma entrara em contato por chamada normal no ${phone}.`,
      '',
      `⏰ Lembre-se de que e horario de ${localizedTimeLabel}.`,
      '',
      '⚠️*Para garantir seu desconto, confirme sua disponibilidade para a chamada inicial de avaliacao. Nossa agenda enche rapidamente; se perder a chamada, nao garantimos reagendamento no mesmo dia.*',
    ].join('\n')
  }

  return [
    `📲 Your call is scheduled for ${displayDate} AT ${displayTime} with ${specialistName}🥰.`,
    '',
    `📞 Our Dharma's expert will reach out to you via regular phone call at ${phone}.`,
    '',
    `⏰ Remember it's ${timeLabel}.`,
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

function formatBookedDate(timestamp, state, timezone, languageName) {
  if (!timestamp) {
    return ''
  }

  if (languageName === 'Latin American Spanish' || languageName === 'Portuguese') {
    return new Intl.DateTimeFormat(languageName === 'Portuguese' ? 'pt-BR' : 'es-US', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: getStateTimeZone(state, timezone),
    }).format(new Date(timestamp))
  }

  return formatCustomerStateDate(timestamp, state, timezone)
}

function formatBookedTimeLabel(state, fallbackLabel, languageName) {
  if (languageName !== 'Latin American Spanish' && languageName !== 'Portuguese') {
    return fallbackLabel
  }

  return String(state || '').trim() || fallbackLabel.replace(/\s+Time$/i, '')
}

function normalizeNameKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function normalizeBookedLanguageName(language) {
  const normalized = String(language || '').toLowerCase()

  if (normalized.includes('spanish') || normalized.includes('espanol') || normalized.includes('español')) {
    return 'Latin American Spanish'
  }

  if (normalized.includes('portuguese') || normalized.includes('portugues') || normalized.includes('português')) {
    return 'Portuguese'
  }

  if (normalized.includes('english') || normalized.includes('ingles') || normalized.includes('inglés')) {
    return 'English'
  }

  return ''
}
