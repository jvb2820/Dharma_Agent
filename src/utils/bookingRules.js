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
  return /\b(sundays?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|domingos?|lunes|martes|miercoles|jueves|viernes|sabados?|segundas?|tercas?|quartas?|quintas?|sextas?)\b/.test(normalized) ||
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

  return rejectsSlot ? startTime + delayMs : undefined
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

function normalizeRuleText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}
