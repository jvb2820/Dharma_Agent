function normalizeRuleText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function isGeneralZepboundQuestion(content = '') {
  const normalized = normalizeRuleText(content)
  if (!/\bzepbound\b/.test(normalized)) return false

  const thirdParty = /\b(client|patient|customer|cliente|paciente|she|he|her|his|ella|ellos|ellas|ele|ela|celebrity|celebridad|figura publica|public figure)\b/.test(normalized)
  const namedPersonUse = /\b[A-Z][a-zA-ZÀ-ÿ'-]{2,}\s+[A-Z][a-zA-ZÀ-ÿ'-]{2,}\b/.test(String(content)) &&
    /\b(use|used|take|took|uses|uso|utilizo|tomo|usou|tomou)\b/.test(normalized)

  return !thirdParty && !namedPersonUse
}

export function isInsuranceQuestion(content = '') {
  const normalized = normalizeRuleText(content)

  return [
    /\b(insurance|health insurance|medical insurance)\b/,
    /\b(aceptan|acepta|aceptamos|aseptan|asectan|afectan|cubren|cubre)\b[\s\S]{0,30}\b(seguro|aseguranza)\b/,
    /\b(seguro|aseguranza)\b[\s\S]{0,30}\b(aceptan|acepta|aseptan|asectan|afectan|cubren|cubre)\b/,
    /\b(aceitam|aceita|cobrem|cobre)\b[\s\S]{0,30}\b(seguro|plano de saude)\b/,
  ].some((pattern) => pattern.test(normalized))
}

export function getInsuranceAnswer(language = '') {
  const normalizedLanguage = String(language).toLowerCase()

  if (normalizedLanguage.includes('spanish')) {
    return 'En este momento no aceptamos seguro médico, pero ofrecemos diferentes opciones de pago y financiamiento. Durante la llamada de análisis gratuita, nuestro especialista puede explicarte las alternativas disponibles.'
  }

  if (normalizedLanguage.includes('portuguese')) {
    return 'No momento não aceitamos seguro médico, mas oferecemos diferentes opções de pagamento e financiamento. Durante a chamada gratuita de análise, nosso especialista pode explicar as alternativas disponíveis.'
  }

  return 'We do not currently accept medical insurance, but we offer different payment and financing options. During the free discovery call, our specialist can explain the available alternatives.'
}

export function isInitialConsultationCostQuestion(content = '') {
  const normalized = normalizeRuleText(content)
  const consultation = /\b(consultation|consult|appointment|discovery call|analysis call|consulta|cita|llamada|chamada)\b/.test(normalized)
  const cost = /\b(cost|price|charge|fee|how much|cuanto|cuesta|cobran|precio|costo|quanto|custa|preco)\b/.test(normalized)
  return consultation && cost
}

export function getInitialConsultationCostAnswer(language = '') {
  const normalizedLanguage = String(language).toLowerCase()

  if (normalizedLanguage.includes('spanish')) {
    return 'La llamada de análisis inicial es completamente gratuita. En esa llamada te explican las opciones de GLP-1, los precios y los siguientes pasos sin compromiso.'
  }

  if (normalizedLanguage.includes('portuguese')) {
    return 'A chamada inicial de análise é completamente gratuita. Nessa chamada explicam as opções de GLP-1, os preços e os próximos passos sem compromisso.'
  }

  return 'The initial discovery call is completely free. During it, the specialist explains the GLP-1 options, pricing, and next steps with no obligation.'
}

export function classifyBookingFailure(error) {
  const message = normalizeRuleText(error?.message || error)
  const status = Number(error?.status || error?.statusCode || 0)

  if (status === 429 || /\b(rate limit|too many requests|temporar|timeout|timed out|fetch failed|econnreset|service unavailable)\b/.test(message)) {
    return 'temporary'
  }

  if (status === 409 || /\b(slot|time)\b[\s\S]{0,40}\b(no longer|unavailable|not available|already booked|conflict|taken)\b/.test(message)) {
    return 'slot_unavailable'
  }

  if (/\b(phone|first name|last name|email|required field|invalid customer)\b/.test(message)) {
    return 'invalid_details'
  }

  return 'unknown'
}

export function isGeneratedBookingPromptLine(line = '') {
  const normalized = String(line || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

  return /\b(quieres|deseas|puedo|podemos)\b[\s\S]{0,50}\b(reservar|agendar)\b/.test(normalized) ||
    /\b(agendo|agendamos|agendare|agendaremos|reservamos|reservare|reservaremos|confirmo|confirmamos|confirmare|confirmaremos)\b[\s\S]{0,80}\b(cita|llamada|consulta|horario)\b/.test(normalized) ||
    /\b(para|a fin de)\b[\s\S]{0,35}\b(completar|terminar|confirmar)\b[\s\S]{0,50}\b(cita|reserva|agenda)\b[\s\S]{0,80}\b(nombre|telefono|numero)\b/.test(normalized) ||
    /\b(para|a fin de)\b[\s\S]{0,35}\b(completar|terminar)\b[\s\S]{0,50}\b(cita|reserva|agenda)\b/.test(normalized) ||
    /\b(would you like|do you want|can i|can we)\b[\s\S]{0,50}\b(reserve|book|schedule)\b/.test(normalized) ||
    /\b(quer|gostaria|posso|podemos)\b[\s\S]{0,50}\b(reservar|agendar)\b/.test(normalized)
}
