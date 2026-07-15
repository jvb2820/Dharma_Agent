const DEFAULT_TRANSFER_IDLE_HOURS = 24
const TRANSFER_REQUEST_PATTERNS = [
  /\b(human|person|representative|agent|manager|supervisor|customer service|customer care|support team|specialist)\b/,
  /\b(speak|talk|chat|connect|transfer|escalate|forward|switch|pass me|put me)\b/,
  /\b(representante|persona|humano|humana|agente|gerente|supervisor|servicio al cliente|atencion al cliente|soporte|especialista)\b/,
  /\b(hablar|conectar|transferir|pasar|comunicar|derivar|escalar)\b/,
  /\b(representante|pessoa|humano|humana|agente|gerente|supervisor|atendimento|suporte|especialista)\b/,
  /\b(falar|conectar|transferir|passar|encaminhar|escalar)\b/,
]
const IRATE_PATTERNS = [
  /\b(angry|upset|mad|furious|frustrated|annoyed|unhappy|disappointed|complaint|complain|ridiculous|terrible|horrible|awful|unacceptable|scam|fraud|lawsuit|lawyer|attorney|cancel|refund|chargeback|report you|bad service|worst)\b/,
  /\b(enojad[oa]|molest[oa]|furios[oa]|frustrad[oa]|decepcionad[oa]|queja|reclamo|reclamar|ridiculo|terrible|horrible|pesimo|inaceptable|estafa|fraude|demanda|abogado|abogada|cancelar|reembolso|devolucion|contracargo|reportar|mal servicio|peor)\b/,
  /\b(brav[oa]|irritad[oa]|furios[oa]|frustrad[oa]|chatead[oa]|decepcionad[oa]|reclamacao|reclamar|queixa|ridiculo|terrivel|horrivel|pessimo|inaceitavel|golpe|fraude|processo|advogado|advogada|cancelar|reembolso|estorno|denunciar|mau atendimento|pior)\b/,
]

export function getRespondAutomationDecision({ contactProfile, session = {}, event = {}, now = Date.now() } = {}) {
  const sessionHandoffActive = Boolean(session.transferHandoffAt || session.handoffAt)
  const sessionHandoffAt = getSessionHandoffAt(session)
  const sessionClosedAfterHandoff = Boolean(session.transferClosedAt)
  const assignee = getConversationAssignee(contactProfile)
  const assigned = isConversationAssigned(contactProfile)
  const closed = isConversationClosed(contactProfile)
  const conversationOpenedAt = getConversationOpenedAt(contactProfile)
  const idleResumeEnabled = isTransferIdleResumeEnabled()
  const lastHumanActivityAt = getLastHumanActivityAt(contactProfile, session)
  const idleExpired = isTransferIdleExpired({ lastHumanActivityAt, now })

  if (assigned && closed) {
    return {
      action: 'allow_closed_restart',
      assignee,
      closed,
      contactId: event.contactId,
      reason: 'Conversation is assigned but closed, so automation can restart on the new inbound message.',
    }
  }

  if (
    assigned &&
    sessionHandoffActive &&
    !closed &&
    (sessionClosedAfterHandoff || didConversationOpenAfterHandoff({
      conversationOpenedAt,
      sessionHandoffAt,
    }))
  ) {
    return {
      action: 'allow_reopened_restart',
      assignee,
      closed,
      contactId: event.contactId,
      conversationOpenedAt,
      lastHumanActivityAt,
      reason: sessionClosedAfterHandoff
        ? 'Conversation was previously closed after transfer and is now open again, so automation can restart.'
        : 'Conversation was reopened by the contact after a previous transfer handoff, so automation can restart.',
    }
  }

  if (!assigned && sessionHandoffActive) {
    return {
      action: 'allow_unassigned_restart',
      assignee,
      closed,
      contactId: event.contactId,
      conversationOpenedAt,
      lastHumanActivityAt,
      reason: 'Conversation has a previous transfer marker but is currently unassigned, so automation can restart.',
    }
  }

  if (assigned && idleResumeEnabled && idleExpired) {
    return {
      action: 'allow_idle_timeout',
      assignee,
      closed,
      contactId: event.contactId,
      idleHours: getTransferIdleHours(),
      lastHumanActivityAt,
      reason: 'Assigned/open handoff exceeded the configured idle window.',
    }
  }

  if (assigned) {
    return {
      action: 'skip_human_owned',
      assignee,
      closed,
      contactId: event.contactId,
      idleHours: getTransferIdleHours(),
      lastHumanActivityAt,
      reason: closed === false
        ? 'Conversation is assigned and open, so a human owns it.'
        : 'Conversation is assigned and status is not closed, so a human owns it.',
    }
  }

  return {
    action: 'allow',
    assignee,
    closed,
    contactId: event.contactId,
    reason: 'Conversation is not assigned to a human.',
  }
}

export function isConversationAssigned(profile = {}) {
  return Boolean(getConversationAssignee(profile))
}

export function isConversationClosed(profile = {}) {
  const status = getConversationStatus(profile)

  if (!status) {
    return false
  }

  return /\b(close|closed|done|resolved|complete|completed)\b/i.test(status)
}

export function getConversationAssignee(profile = {}) {
  const conversation = getConversation(profile)
  const candidates = [
    conversation.assignee,
    conversation.assignedTo,
    conversation.assigned_to,
    conversation.assigneeId,
    conversation.assignee_id,
    conversation.assigneeEmail,
    conversation.assignee_email,
    conversation.user,
    conversation.userId,
    conversation.user_id,
    profile.conversationAssignee,
    profile.assignee,
  ]

  for (const candidate of candidates) {
    const value = normalizeAssignee(candidate)

    if (value) {
      return value
    }
  }

  return ''
}

export function getLastHumanActivityAt(profile = {}, session = {}) {
  const conversation = getConversation(profile)
  const candidates = [
    conversation.lastHumanActivityAt,
    conversation.last_human_activity_at,
    conversation.lastAssigneeActivityAt,
    conversation.last_assignee_activity_at,
    conversation.lastMessageAt,
    conversation.last_message_at,
    conversation.updatedAt,
    conversation.updated_at,
    conversation.assignedAt,
    conversation.assigned_at,
    profile.lastHumanActivityAt,
    session.transferHandoffAt,
    session.handoffAt,
  ]

  for (const candidate of candidates) {
    const timestamp = normalizeTimestamp(candidate)

    if (timestamp) {
      return timestamp
    }
  }

  return null
}

export function getConversationOpenedAt(profile = {}) {
  const conversation = getConversation(profile)
  const candidates = [
    conversation.openedAt,
    conversation.opened_at,
    conversation.reopenedAt,
    conversation.reopened_at,
    conversation.createdAt,
    conversation.created_at,
    profile.conversationOpenedAt,
  ]

  for (const candidate of candidates) {
    const timestamp = normalizeTimestamp(candidate)

    if (timestamp) {
      return timestamp
    }
  }

  return null
}

function getSessionHandoffAt(session = {}) {
  return normalizeTimestamp(session.transferHandoffAt || session.handoffAt)
}

function didConversationOpenAfterHandoff({ conversationOpenedAt, sessionHandoffAt } = {}) {
  if (!conversationOpenedAt || !sessionHandoffAt) {
    return false
  }

  return conversationOpenedAt > sessionHandoffAt + 1000
}

export function isTransferIdleExpired({ lastHumanActivityAt, now = Date.now() } = {}) {
  if (!lastHumanActivityAt) {
    return false
  }

  return now - lastHumanActivityAt >= getTransferIdleHours() * 60 * 60 * 1000
}

export function getTransferIdleHours() {
  const value = Number(process.env.RESPOND_TRANSFER_IDLE_HOURS)

  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TRANSFER_IDLE_HOURS
}

export function isTransferIdleResumeEnabled() {
  const value = String(process.env.RESPOND_TRANSFER_IDLE_RESUME ?? 'true').trim().toLowerCase()

  return !['0', 'false', 'no', 'off', 'disabled'].includes(value)
}

export function detectRespondTransferTrigger(text = '') {
  const normalized = normalizeTriggerText(text)

  if (!normalized) {
    return null
  }

  const requestedTransfer =
    TRANSFER_REQUEST_PATTERNS.some((pattern) => pattern.test(normalized)) &&
    /\b(speak|talk|chat|connect|transfer|escalate|forward|switch|pass|put|human|person|representative|agent|manager|supervisor|customer service|customer care|support|specialist|hablar|conectar|transferir|pasar|comunicar|derivar|escalar|persona|humano|humana|representante|agente|gerente|supervisor|servicio|atencion|soporte|especialista|falar|encaminhar|pessoa|atendimento)\b/.test(
      normalized,
    )

  if (requestedTransfer) {
    return {
      type: 'transfer_request',
      reason: 'Customer requested a human transfer or escalation.',
    }
  }

  if (IRATE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return {
      type: 'irate_customer',
      reason: 'Customer message indicates frustration, complaint, refund/cancel pressure, or escalation risk.',
    }
  }

  return null
}

export function buildRespondTransferMessage({ customerLanguage = 'English', trigger = null } = {}) {
  const language = String(customerLanguage || '').toLowerCase()

  if (language.includes('spanish') || /\bes\b/.test(language)) {
    return [
      '💛 Siento mucho que estés pasando por esta situación. Gracias por decírnoslo con claridad.',
      '',
      'Voy a transferirte ahora con nuestro equipo de Customer Service para que un especialista experto en este tipo de situación pueda revisar tu caso y ayudarte con más detalle. 🙏',
    ].join('\n')
  }

  if (language.includes('portuguese') || /\bpt\b/.test(language)) {
    return [
      '💛 Sinto muito que você esteja passando por essa situação. Obrigado por nos explicar.',
      '',
      'Vou transferir você agora para nossa equipe de Customer Service, para que um especialista experiente nesse tipo de situação possa revisar seu caso e ajudar com mais detalhes. 🙏',
    ].join('\n')
  }

  const intro =
    trigger?.type === 'transfer_request'
      ? 'Of course. I can connect you with our team now.'
      : 'I am really sorry you are dealing with this. Thank you for telling us clearly.'

  return [
    `💛 ${intro}`,
    '',
    'I am transferring you now to our Customer Service team so a specialist who is experienced with this kind of situation can review your case and help you in more detail. 🙏',
  ].join('\n')
}

function getConversationStatus(profile = {}) {
  const conversation = getConversation(profile)
  const status = [
    conversation.status,
    conversation.conversationStatus,
    conversation.conversation_status,
    conversation.state,
    profile.conversationStatus,
  ]
    .map((value) => String(value || '').trim())
    .find(Boolean)

  return status || ''
}

function getConversation(profile = {}) {
  return profile.conversation || profile.rawContact?.conversation || profile.rawContact?.conversationInfo || {}
}

function normalizeAssignee(value) {
  if (!value) {
    return ''
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim()
  }

  if (typeof value === 'object') {
    return String(
      value.email ||
        value.name ||
        value.fullName ||
        value.full_name ||
        value.id ||
        value.userId ||
        value.user_id ||
        '',
    ).trim()
  }

  return ''
}

function normalizeTimestamp(value) {
  if (!value) {
    return null
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000
  }

  const parsed = Date.parse(value)

  return Number.isNaN(parsed) ? null : parsed
}

function normalizeTriggerText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}
