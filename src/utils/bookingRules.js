export function chooseConfirmedState({ latestState = '', activeState = '', profileState = '', historicalState = '' } = {}) {
  return latestState || activeState || profileState || historicalState || ''
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

function normalizeRuleText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}
