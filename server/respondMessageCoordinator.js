const DEFAULT_DEDUPLICATION_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_MAX_PROCESSED_MESSAGES = 10_000

export function createRespondMessageCoordinator({
  deduplicationTtlMs = DEFAULT_DEDUPLICATION_TTL_MS,
  maxProcessedMessages = DEFAULT_MAX_PROCESSED_MESSAGES,
  debounceMs = 0,
  now = () => Date.now(),
} = {}) {
  const contactQueues = new Map()
  const processedMessages = new Map()
  const pendingBatches = new Map()

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

    if (debounceMs > 0) {
      return enqueueBuffered({ normalizedContactId, normalizedMessageId, task })
    }

    const previous = contactQueues.get(normalizedContactId) || Promise.resolve()
    const current = previous.catch(() => {}).then(() => task({
      messageIds: normalizedMessageId ? [normalizedMessageId] : [],
    }))
    const settled = current.finally(() => {
      if (contactQueues.get(normalizedContactId) === settled) {
        contactQueues.delete(normalizedContactId)
      }
    })

    contactQueues.set(normalizedContactId, settled)

    return { accepted: true, duplicate: false, promise: settled }
  }

  function enqueueBuffered({ normalizedContactId, normalizedMessageId, task }) {
    let resolveEntry
    let rejectEntry
    const promise = new Promise((resolve, reject) => {
      resolveEntry = resolve
      rejectEntry = reject
    })
    const batch = pendingBatches.get(normalizedContactId) || { entries: [], timer: null }
    batch.entries.push({ messageId: normalizedMessageId, task, resolve: resolveEntry, reject: rejectEntry })
    if (batch.timer) clearTimeout(batch.timer)
    batch.timer = setTimeout(() => flushBatch(normalizedContactId), debounceMs)
    batch.timer.unref?.()
    pendingBatches.set(normalizedContactId, batch)
    return { accepted: true, duplicate: false, promise }
  }

  function flushBatch(contactId) {
    const batch = pendingBatches.get(contactId)
    if (!batch) return
    pendingBatches.delete(contactId)
    const entries = batch.entries
    const latest = entries.at(-1)
    const messageIds = entries.map((entry) => entry.messageId).filter(Boolean)
    const previous = contactQueues.get(contactId) || Promise.resolve()
    const current = previous.catch(() => {}).then(() => latest.task({ messageIds }))
    const settled = current.finally(() => {
      if (contactQueues.get(contactId) === settled) contactQueues.delete(contactId)
    })
    contactQueues.set(contactId, settled)
    current.then(
      (result) => entries.forEach((entry) => entry.resolve(result)),
      (error) => entries.forEach((entry) => entry.reject(error)),
    )
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
    getBufferedContactCount: () => pendingBatches.size,
    getProcessedMessageCount: () => processedMessages.size,
  }
}
