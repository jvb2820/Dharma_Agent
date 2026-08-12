const DEFAULT_FOLLOW_UP_DELAY_MS = 60 * 60 * 1000

export function isInactivityFollowUpDue(session = {}, now = Date.now(), delayMs = DEFAULT_FOLLOW_UP_DELAY_MS) {
  const lastInteractionAt = Number(session.lastInteractionAt || 0)

  return Boolean(
    session.channelId &&
    session.booking &&
    lastInteractionAt > 0 &&
    !session.inactivityFollowUpSentAt &&
    !session.transferHandoffAt &&
    !session.handoffAt &&
    !session.transferClosedAt &&
    !session.postBookingLock &&
    !session.humanTakeoverLock &&
    now - lastInteractionAt >= delayMs,
  )
}

export function buildInactivityFollowUpMessage({ customerLanguage = 'English', continuation = '' } = {}) {
  const language = String(customerLanguage || '').toLowerCase()
  let intro = 'Just checking in—are you still interested? I’m here to help you continue.'

  if (language.includes('spanish') || /\bes\b/.test(language)) {
    intro = 'Solo quería saber si todavía te interesa. Estoy aquí para ayudarte a continuar.'
  } else if (language.includes('portuguese') || /\bpt\b/.test(language)) {
    intro = 'Só queria confirmar se você ainda tem interesse. Estou aqui para ajudar você a continuar.'
  }

  return [intro, String(continuation || '').trim()].filter(Boolean).join('\n\n')
}

