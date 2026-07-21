export function chooseConfirmedState({ latestState = '', activeState = '', profileState = '', historicalState = '' } = {}) {
  return latestState || activeState || profileState || historicalState || ''
}

export function hasStrictRequestedDay(preferredTime = '') {
  const normalized = normalizeRuleText(preferredTime)
  return /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|domingo|lunes|martes|miercoles|jueves|viernes|sabado|segunda|terca|quarta|quinta|sexta)\b/.test(normalized) ||
    /\b(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+\d{1,2}\b/.test(normalized) ||
    /\b\d{1,2}[/-]\d{1,2}\b/.test(normalized)
}

function normalizeRuleText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}
