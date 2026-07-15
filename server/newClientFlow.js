export function isExactRespondClientStatus(profile = {}) {
  return normalizeStatus(profile?.fields?.contactStatus) === 'client'
}

export function shouldUseNewClientBookingFlow(profile = {}) {
  return !isExactRespondClientStatus(profile)
}

export function createDummyEmailFromProvidedPhone(phone) {
  const digits = normalizePhoneDigitsForEmail(phone)

  return digits ? `${digits}@dummy.com` : ''
}

export function normalizePhoneDigitsForEmail(phone) {
  const digits = String(phone || '').replace(/\D/g, '')

  if (digits.length === 10) {
    return `1${digits}`
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return digits
  }

  return digits
}

export function extractCustomerFullName(content = '') {
  const withoutPhoneOrEmail = stripPhoneAndEmail(content)
  const explicitName = extractExplicitName(withoutPhoneOrEmail)
  const candidate = explicitName || withoutPhoneOrEmail

  return cleanFullNameCandidate(candidate)
}

export function splitCustomerFullName(content = '') {
  const fullName = extractCustomerFullName(content)

  if (!fullName) {
    return {}
  }

  const parts = fullName.split(/\s+/).filter(Boolean)

  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
    nameConfirmed: true,
  }
}

export function hasConfirmedFullName(details = {}) {
  return Boolean(
    details.nameConfirmed &&
      details.firstName &&
      details.lastName &&
      isFullNameCandidate([details.firstName, details.lastName].filter(Boolean).join(' ')),
  )
}

function extractExplicitName(content) {
  const patterns = [
    /\b(?:my\s+(?:full\s+)?name\s+is|name\s+is|this\s+is|it'?s|its)\s+([^.!?,;\n]+)/i,
    /\b(?:book(?:\s+it)?\s+(?:for|under)|put\s+(?:it\s+)?(?:for|under)|use\s+(?:the\s+)?name)\s+([^.!?,;\n]+)/i,
    /\b(?:mi\s+nombre\s+es|soy|me\s+llamo|a\s+nombre\s+de)\s+([^.!?,;\n]+)/i,
    /\b(?:meu\s+nome\s+e|meu\s+nome\s+é|sou|em\s+nome\s+de)\s+([^.!?,;\n]+)/i,
  ]

  for (const pattern of patterns) {
    const match = String(content || '').match(pattern)

    if (match?.[1]) {
      return match[1]
    }
  }

  return ''
}

function cleanFullNameCandidate(value) {
  const cleaned = String(value || '')
    .replace(/\b(?:please|pls|thanks|thank you|gracias|por favor|obrigado|obrigada)\b/gi, ' ')
    .replace(/\b(?:book|appointment|cita|consulta|call|llamada|chamada|slot|time|hora|horario)\b/gi, ' ')
    .replace(/[^A-Za-zÀ-ÖØ-öø-ÿ' -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!isFullNameCandidate(cleaned)) {
    return ''
  }

  return cleaned
}

function isFullNameCandidate(value) {
  const parts = String(value || '').split(/\s+/).filter(Boolean)
  const normalized = normalizeStatus(value)

  if (parts.length < 2 || parts.length > 5) {
    return false
  }

  if (!/^[\p{L}][\p{L}' -]+$/u.test(value)) {
    return false
  }

  return !/\b(yes|yeah|yep|ok|okay|sure|no|not|only|available|availability|later|tomorrow|today|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|si|claro|dale|hola|hello|hi|price|cost|weight|loss|injection|state|florida|california|client|medication|medicine|treatment|appointment|call)\b/.test(
    normalized,
  )
}

function stripPhoneAndEmail(content) {
  return String(content || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ')
    .replace(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4,}/g, ' ')
}

function normalizeStatus(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
