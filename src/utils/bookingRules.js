export function chooseConfirmedState({ latestState = '', activeState = '', profileState = '', historicalState = '' } = {}) {
  return latestState || activeState || profileState || historicalState || ''
}

export function resolveKansasLocationClarification(content = '', awaitingClarification = false) {
  const normalized = normalizeRuleText(content).replace(/[^a-z0-9]+/g, ' ').trim()

  if (/\b(kansas city|kc)\b[\s,]*(missouri|mo)\b/.test(normalized)) {
    return { state: 'Missouri', needsClarification: false }
  }
  if (/\b(kansas city|kc)\b[\s,]*(kansas|ks)\b/.test(normalized)) {
    return { state: 'Kansas', needsClarification: false }
  }
  if (/\b(state of kansas|kansas state|estado de kansas|estado do kansas)\b/.test(normalized)) {
    return { state: 'Kansas', needsClarification: false }
  }
  if (awaitingClarification) {
    if (/^(missouri|mo)$/.test(normalized)) return { state: 'Missouri', needsClarification: false }
    if (/^(kansas|ks|the state|el estado|o estado)$/.test(normalized)) {
      return { state: 'Kansas', needsClarification: false }
    }
  }
  if (/^(kansas|kansas city|kc)$/.test(normalized)) {
    return { state: '', needsClarification: true }
  }
  return { state: '', needsClarification: false }
}

export function hasStrictRequestedDay(preferredTime = '') {
  const normalized = normalizeRuleText(preferredTime)
  return /\b(next week|following week|proxima semana|semana que viene|semana siguiente|semana seguinte)\b/.test(normalized) ||
    /\b(sundays?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|domingos?|lunes|martes|miercoles|jueves|viernes|sabados?|segundas?|tercas?|quartas?|quintas?|sextas?)\b/.test(normalized) ||
    /\b(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+\d{1,2}\b/.test(normalized) ||
    /\b\d{1,2}[/-]\d{1,2}\b/.test(normalized)
}

export function rejectsOfferedCalendarDate(content = '') {
  const normalized = normalizeRuleText(content)
  const negative = /\b(can['’]?t|can t|cannot|cant|can not|not available|doesn['’]?t work|doesn t work|no puedo|no podre|no podria|no me funciona|no estoy disponible|nao posso|nao consigo|nao funciona)\b/.test(normalized)
  const date = /\b(today|tomorrow|day after tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|hoy|manana|pasado manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|hoje|amanha|segunda|terca|quarta|quinta|sexta)\b/.test(normalized)

  return negative && date
}

export function getNextPreferenceAfterRejectedRelativeDay(content = '') {
  const normalized = normalizeRuleText(content)
  const negative = /\b(can['’]?t|can t|cannot|cant|can not|not available|doesn['’]?t work|doesn t work|no puedo|no podre|no podria|no me funciona|no estoy disponible|nao posso|nao consigo|nao funciona)\b/.test(normalized)

  if (!negative) return ''

  if (/\b(tomorrow|manana|amanha)\b/.test(normalized)) {
    return 'day after tomorrow'
  }

  if (/\b(today|hoy|hoje)\b/.test(normalized)) {
    return 'tomorrow'
  }

  return ''
}

export function getMinimumStartAfterSlotRejection(
  content = '',
  offeredStartTime,
  delayMs = 3 * 60 * 60 * 1000,
) {
  const startTime = Number(offeredStartTime)

  if (!Number.isFinite(startTime) || rejectsOfferedCalendarDate(content)) {
    return undefined
  }

  const normalized = normalizeRuleText(content)
  const rejectsSlot =
    /\b(can['’]?t|can t|cannot|cant|can not|not available|doesn['’]?t work|doesn t work|no puedo|no podre|no podria|no me funciona|no estoy disponible|nao posso|nao consigo|nao funciona)\b/.test(normalized)

  const rejectsConversationalSlot =
    /\bno\b[\s\S]{0,50}\b(?:that|this|esa|ese|esta|este)?\s*(?:time|hour|hora|horario)\b/.test(normalized) ||
    /\b(?:working|at work|trabajando|en el trabajo|trabalhando)\b/.test(normalized)

  return rejectsSlot || rejectsConversationalSlot ? startTime + delayMs : undefined
}

export function getLaterSlotDelayMs(offeredLocalHour) {
  return Number(offeredLocalHour) >= 16
    ? 60 * 60 * 1000
    : 3 * 60 * 60 * 1000
}

export function parseAfterTimePreference(content = '') {
  const normalized = normalizeRuleText(content)
  const match = normalized.match(
    /\b(?:after|later than|from|despues de|despues de las|a partir de|a partir de las|mas tarde de|mas tarde de las)\s+(?:las\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/,
  )

  if (!match) return null

  let hour = Number(match[1])
  const minute = Number(match[2] || 0)
  const period = match[3] || ''

  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null
  if (period === 'am') hour = hour === 12 ? 0 : hour
  else if (period === 'pm') hour = hour === 12 ? 12 : hour + 12
  else if (hour >= 1 && hour <= 7) hour += 12

  return {
    hour,
    minute,
    minutesOfDay: hour * 60 + minute,
  }
}

export function confirmsOfferedSlotTime(content = '', offeredHour, offeredMinute = 0) {
  if (!Number.isInteger(offeredHour) || !Number.isInteger(offeredMinute)) {
    return false
  }

  const normalized = normalizeRuleText(content)
  const confirms = /\b(yes|yeah|yep|ok|okay|sure|works|perfect|confirm|si|claro|dale|esta bien|correcto|confirmo|agendalo|reserva)\b/.test(normalized)
  const match =
    normalized.match(/\b(?:at|a las|las)\s+(1[0-2]|0?[1-9])(?::(\d{2}))?\s*(am|pm)?\b/) ||
    normalized.match(/\b(1[0-2]|0?[1-9])(?::(\d{2}))?\s*(am|pm)\b/)

  if (!confirms || !match) {
    return false
  }

  let requestedHour = Number(match[1])
  const requestedMinute = match[2] == null ? 0 : Number(match[2])
  const period = match[3] || ''

  if (period === 'pm' && requestedHour < 12) requestedHour += 12
  if (period === 'am' && requestedHour === 12) requestedHour = 0

  const hourMatches = period
    ? requestedHour === offeredHour
    : requestedHour % 12 === offeredHour % 12

  return hourMatches && requestedMinute === offeredMinute
}

export function isEarlierSchedulingPreference(content = '') {
  const normalized = normalizeRuleText(content)
  const usesBeforeAsConversationOrder = [
    /\b(?:but|pero|mas)\s+(?:first|before|antes)\b[\s,]*(?:can|could|would|me puedes|me podrias|puedes|podrias|pode|poderia)\b/,
    /\bantes\s+(?:me\s+)?(?:puedes|podrias|puede|pode|poderia)\s+(?:decir|dizer|tell|explain|explicar|confirmar)\b/,
    /\bantes de (?:confirmar|agendar|reservar|continuar|seguir)\b/,
  ].some((pattern) => pattern.test(normalized))

  if (usesBeforeAsConversationOrder) {
    return false
  }

  return /\b(earlier|something earlier|before that|mas temprano|algo mas temprano|antes|mais cedo|algo mais cedo)\b/.test(normalized)
}

export function hasCallFormatQuestion(content = '') {
  const normalized = normalizeRuleText(content)
  const mentionsCall = /\b(call|phone call|video call|videocall|appointment|llamada|videollamada|cita|chamada|videochamada|consulta)\b/.test(normalized)
  const asksFormat = /\b(regular|normal|phone|video|videollamada|telefono|telefonica|por chamada|videochamada|como sera|como es|que tipo)\b/.test(normalized)

  return mentionsCall && asksFormat
}

export function isExactCasualAffirmative(content = '') {
  const normalized = normalizeRuleText(content).replace(/[^a-z0-9]+/g, ' ').trim()

  return normalized === 'sip'
}

export function shouldTreatOkAsAffirmative({
  content = '',
  activeState = '',
  inferredState = '',
  hasActiveSlot = false,
} = {}) {
  const normalized = normalizeRuleText(content).replace(/[^a-z0-9]+/g, ' ').trim()

  return normalized === 'ok' && Boolean(activeState || inferredState || hasActiveSlot)
}

export function shouldAcceptStateAbbreviationToken({
  rawToken = '',
  abbreviation = '',
  content = '',
} = {}) {
  const normalizedToken = String(rawToken).toLowerCase()
  const normalizedContent = normalizeRuleText(content).replace(/[^a-z0-9]+/g, ' ').trim()
  const upperToken = String(rawToken).toUpperCase()
  const ambiguousWords = new Set(['DE', 'HI', 'IN', 'LA', 'ME', 'MI', 'OK', 'OR'])

  // A bare "ok" can answer a pending state question as Oklahoma. Once a state
  // or slot is active, the booking flow handles the same text as an affirmative
  // before state extraction is applied.
  if (String(abbreviation).toUpperCase() === 'OK' && normalizedContent === 'ok') {
    return true
  }

  if (
    ambiguousWords.has(String(abbreviation).toUpperCase()) &&
    rawToken !== upperToken
  ) {
    return false
  }

  const isStandaloneAbbreviation = normalizedContent === normalizedToken
  const escapedToken = escapeRuleRegExp(normalizedToken)
  const hasStateContext = [
    new RegExp(String.raw`\b(?:state|estado)\s+(?:is|es|e|of|de)?\s*${escapedToken}\b`),
    new RegExp(
      String.raw`\b(?:live|lives|living|located|from|vivo|vive|viviendo|soy|estoy|moro|mora|sou|estou)\s+(?:in|en|em|from|de)?\s*${escapedToken}\b`,
    ),
    new RegExp(
      String.raw`\b(?:ship|shipping|deliver|delivery|send|envio|envios|enviar|entrega|entregas)\b[\s\S]{0,30}\b(?:to|in|a|en|em|para)\s+${escapedToken}\b`,
    ),
    new RegExp(String.raw`^(?:in|en|em|from|de)\s+${escapedToken}$`),
  ].some((pattern) => pattern.test(normalizedContent))
  const locationTokens = normalizedContent.split(/\s+/)
  const hasConciseCityBeforeAbbreviation =
    locationTokens.length >= 2 &&
    locationTokens.length <= 3 &&
    locationTokens.at(-1) === normalizedToken

  return isStandaloneAbbreviation || hasStateContext || hasConciseCityBeforeAbbreviation
}

export function findStateNameWithMinorTypo(content = '', states = []) {
  const normalized = normalizeRuleText(content).replace(/[^a-z0-9]+/g, ' ').trim()

  if (!normalized) {
    return ''
  }

  const locationMatch = normalized.match(
    /\b(?:i live in|i lived in|i am from|i m from|my state is|vivo en|soy de|mi estado es|moro em|sou de|meu estado e)\s+(.+)$/,
  )
  const locationText =
    locationMatch?.[1]?.trim() ||
    (normalized.split(' ').length <= 3 ? normalized : '')

  if (!locationText) {
    return ''
  }

  const locationTokens = locationText.split(/\s+/)

  const matches = []

  for (const state of states) {
    const normalizedState = normalizeRuleText(state).replace(/[^a-z0-9]+/g, ' ').trim()

    // Short state names create too many accidental matches. Require exact
    // handling for those through the normal state and abbreviation parsers.
    if (normalizedState.replace(/\s/g, '').length < 5) {
      continue
    }

    const stateWordCount = normalizedState.split(' ').length
    const candidates = []

    for (let index = 0; index <= locationTokens.length - stateWordCount; index += 1) {
      candidates.push(locationTokens.slice(index, index + stateWordCount).join(' '))
    }

    if (candidates.some((candidate) => getDamerauLevenshteinDistance(candidate, normalizedState) <= 1)) {
      matches.push(state)
    }
  }

  return matches.length === 1 ? matches[0] : ''
}

export function looksLikeExplicitStateDeclaration(content = '') {
  const normalized = normalizeRuleText(content).replace(/[^a-z0-9]+/g, ' ').trim()

  return /\b(?:i live in|i lived in|i am from|i m from|my state is|vivo en|soy de|mi estado es|moro em|sou de|meu estado e)\s+\S/.test(
    normalized,
  )
}

export function getUnrecognizedStateAttemptResult(previousAttempts = 0) {
  const attempts = Math.max(0, Number(previousAttempts) || 0) + 1

  return {
    attempts,
    shouldTransfer: attempts >= 2,
  }
}

function getDamerauLevenshteinDistance(left, right) {
  if (left === right) return 0
  if (Math.abs(left.length - right.length) > 1) return 2

  const rows = left.length + 1
  const columns = right.length + 1
  const matrix = Array.from({ length: rows }, () => Array(columns).fill(0))

  for (let row = 0; row < rows; row += 1) matrix[row][0] = row
  for (let column = 0; column < columns; column += 1) matrix[0][column] = column

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + substitutionCost,
      )

      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        matrix[row][column] = Math.min(
          matrix[row][column],
          matrix[row - 2][column - 2] + 1,
        )
      }
    }
  }

  return matrix[left.length][right.length]
}

function escapeRuleRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeRuleText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}
