export function normalizeConversationLanguage(language = '') {
  const normalized = normalizeLanguageText(language)
  if (/\b(spanish|espanol)\b/.test(normalized)) return 'Latin American Spanish'
  if (/\b(portuguese|portugues)\b/.test(normalized)) return 'Portuguese'
  if (/\b(english|ingles)\b/.test(normalized)) return 'English'
  return ''
}

export function detectLatestMessageLanguage(content = '') {
  const normalized = normalizeLanguageText(content)
  if (!normalized) return ''

  if (/\b(no hablo|no entiendo)\s+(portugues|ingles)\b/.test(normalized)) {
    return 'Latin American Spanish'
  }

  if (/\b(no puedo|puedo|mas tarde|solo puedo)\b/.test(normalized)) {
    return 'Latin American Spanish'
  }

  if (/\b(cual|ella|utilizo|fue|el tratamiento)\b/.test(normalized)) {
    return 'Latin American Spanish'
  }

  if (/\b(nao posso|posso|mais tarde|so posso)\b/.test(normalized)) {
    return 'Portuguese'
  }

  const spanish = /\b(no puedo|puedo|mas tarde|solo puedo|sabado|domingo|lunes|martes|miercoles|jueves|viernes|manana|hoy|gracias|quiero|cual|cuanto|hablo|tratamiento|llamada|cita|estado|casa|tengo|ella|utilizo|uso|ofrecen|precio|informacion)\b/.test(normalized)
  const portuguese = /\b(nao posso|posso|mais tarde|sabado|domingo|segunda|terca|quarta|quinta|sexta|amanha|hoje|obrigad[oa]|quero|qual|quanto|falo|tratamento|chamada|agendamento|estado|casa|tenho|ela|usou|oferecem|preco|informacao|voce)\b/.test(normalized)
  const english = /\b(i cannot|i can|later|only|saturday|sunday|monday|tuesday|wednesday|thursday|friday|tomorrow|today|thanks|want|which|how much|speak|treatment|call|appointment|state|house|have|she|used|offer|price|information)\b/.test(normalized)

  if (spanish && !portuguese) return 'Latin American Spanish'
  if (portuguese && !spanish) return 'Portuguese'
  if (english && !spanish && !portuguese) return 'English'
  return ''
}

export function resolveLatestMessageLanguage(content, fallback = '') {
  return detectLatestMessageLanguage(content) || normalizeConversationLanguage(fallback)
}

function normalizeLanguageText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
