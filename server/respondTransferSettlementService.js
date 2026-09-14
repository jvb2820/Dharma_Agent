const DEFAULT_TRANSFER_SETTLEMENT_DELAY_MS = 30_000

export function getRespondTransferSettlementDelayMs() {
  const value = Number(process.env.RESPOND_TRANSFER_SETTLEMENT_DELAY_MS)
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_TRANSFER_SETTLEMENT_DELAY_MS
}

export function buildPendingRespondTransfer({ triggerType = '', now = Date.now() } = {}) {
  const delayMs = getRespondTransferSettlementDelayMs()

  return {
    status: 'pending',
    triggerType,
    startedAt: now,
    settleAt: now + delayMs,
  }
}

export function isPendingRespondTransferActive(pendingTransfer, now = Date.now()) {
  return Boolean(
    pendingTransfer?.status === 'pending' &&
      Number(pendingTransfer.settleAt) > now,
  )
}

export async function settleRespondTransferAssignment({
  contactId,
  assignees = [],
  loadProfile,
  getAssignee,
  assign,
  delay = wait,
  delayMs = getRespondTransferSettlementDelayMs(),
} = {}) {
  await delay(delayMs)

  const profile = await loadProfile(contactId)
  const existingAssignee = getAssignee(profile)
  if (existingAssignee && assignees.includes(existingAssignee)) {
    return { assigned: true, assignee: existingAssignee, profile, retained: true }
  }

  for (const assignee of assignees) {
    try {
      await assign({ contactId, assignee })
      return { assigned: true, assignee, profile, retained: false }
    } catch (error) {
      console.warn(`Unable to settle Respond transfer assignment for ${assignee}: ${error.message}`)
    }
  }

  return { assigned: false, assignee: '', profile, retained: false }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
