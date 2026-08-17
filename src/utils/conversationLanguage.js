export function normalizeConversationLanguage(language = '') {
  const normalized = normalizeLanguageText(language)
  if (/\b(spanish|espanol)\b/.test(normalized)) return 'Latin American Spanish'
  if (/\b(portuguese|portugues)\b/.test(normalized)) return 'Portuguese'
  if (/\b(english|ingles)\b/.test(normalized)) return 'English'
  return ''
}

export function detectLatestMessageLanguage(content = '') {
  const raw = String(content || '').trim()
  const normalized = normalizeLanguageText(content)
  if (!normalized) return ''

  // A standalone 1, 2, or 3, or an explicit "option 1/2/3" reply, is Spanish.
  // Other numbers and time expressions remain language-neutral.
  if (/^(?:[123]|option\s+[123])$/i.test(raw)) {
    return 'Latin American Spanish'
  }

  if (/^(?:los|las)\s+(?:[123]|uno|dos|tres)$/i.test(normalized)) {
    return 'Latin American Spanish'
  }

  // Spanish leads commonly select several numbered options as "1,2 y 3".
  if (/^1\s*2\s*y?\s*3$/.test(normalized)) {
    return 'Latin American Spanish'
  }

  if (/\b(no hablo|no entiendo)\s+(portugues|ingles)\b/.test(normalized)) {
    return 'Latin American Spanish'
  }

  if (/\b(no puedo|puedo|mas tarde|solo puedo)\b/.test(normalized)) {
    return 'Latin American Spanish'
  }

  // Spanish conditional scheduling replies often contain only short words
  // that overlap with Portuguese after accents are removed. "Ese/este
  // horario" and "no podria" are unambiguous Spanish booking phrases.
  if (
    /\b(ese|este|otro)\s+horario\b/.test(normalized) ||
    /\bno+\s+(?:me\s+)?(?:podria|funcionaria|serviria)\b/.test(normalized) ||
    /\b(?:podria|funcionaria|serviria)\s+(?:ese|este|otro)\s+horario\b/.test(normalized)
  ) {
    return 'Latin American Spanish'
  }

  if (/\b(cual|ella|utilizo|fue|el tratamiento)\b/.test(normalized)) {
    return 'Latin American Spanish'
  }

  if (/\b(en nevada|quiero saber|yo soy|soy hipertens[ao]|puedo el|tiene a las|de california)\b/.test(normalized)) {
    return 'Latin American Spanish'
  }

  if (/\b(necesito|tienen|bajar de peso|tirzepatida|vivo en)\b/.test(normalized)) {
    return 'Latin American Spanish'
  }

  if (/\b(nao posso|posso|mais tarde|so posso)\b/.test(normalized)) {
    return 'Portuguese'
  }

  const spanish = /\b(no puedo|puedo|mas tarde|solo puedo|sabado|domingo|lunes|martes|miercoles|jueves|viernes|manana|hoy|gracias|quiero|cual|cuanto|hablo|tratamiento|llamada|cita|estado|casa|tengo|ella|utilizo|uso|ofrecen|precio|informacion|todas? las opciones|opciones|mensual)\b/.test(normalized)
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
