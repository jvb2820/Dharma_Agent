const DEFAULT_DEDUPLICATION_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_MAX_PROCESSED_MESSAGES = 10_000

export function createRespondMessageCoordinator({
  deduplicationTtlMs = DEFAULT_DEDUPLICATION_TTL_MS,
  maxProcessedMessages = DEFAULT_MAX_PROCESSED_MESSAGES,
  now = () => Date.now(),
} = {}) {
  const contactQueues = new Map()
  const processedMessages = new Map()

  function enqueue({ contactId, messageId = '', task }) {
    const normalizedContactId = String(contactId || '').trim()
    const normalizedMessageId = String(messageId || '').trim()
    const deduplicationKey = normalizedMessageId
      ? `${normalizedContactId}:${normalizedMessageId}`
      : ''

    if (!normalizedContactId) {
      throw new Error('contactId is required to coordinate a Respond message.')
    }

    if (typeof task !== 'function') {
      throw new Error('task must be a function.')
    }

    pruneProcessedMessages()

    if (deduplicationKey && processedMessages.has(deduplicationKey)) {
      return { accepted: false, duplicate: true, promise: Promise.resolve() }
    }

    if (deduplicationKey) {
      processedMessages.set(deduplicationKey, now())
      trimProcessedMessages()
    }

    const previous = contactQueues.get(normalizedContactId) || Promise.resolve()
    const current = previous.catch(() => {}).then(task)
    const settled = current.finally(() => {
      if (contactQueues.get(normalizedContactId) === settled) {
        contactQueues.delete(normalizedContactId)
      }
    })

    contactQueues.set(normalizedContactId, settled)

    return { accepted: true, duplicate: false, promise: settled }
  }

  function pruneProcessedMessages() {
    const cutoff = now() - deduplicationTtlMs

    for (const [messageKey, processedAt] of processedMessages) {
      if (processedAt > cutoff) break
      processedMessages.delete(messageKey)
    }
  }

  function trimProcessedMessages() {
    while (processedMessages.size > maxProcessedMessages) {
      const oldestMessageId = processedMessages.keys().next().value
      processedMessages.delete(oldestMessageId)
    }
  }

  return {
    enqueue,
    getActiveContactCount: () => contactQueues.size,
    getProcessedMessageCount: () => processedMessages.size,
  }
}
