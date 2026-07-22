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
  return /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|domingo|lunes|martes|miercoles|jueves|viernes|sabado|segunda|terca|quarta|quinta|sexta)\b/.test(normalized) ||
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

function normalizeRuleText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}
