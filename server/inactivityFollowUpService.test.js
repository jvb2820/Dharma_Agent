import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildInactivityFollowUpMessage,
  isInactivityFollowUpDue,
} from './inactivityFollowUpService.js'

test('follow-up becomes due after one hour for an active booking flow', () => {
  const now = Date.now()
  const session = {
    channelId: 'channel-1',
    booking: { pendingField: 'state' },
    lastInteractionAt: now - 60 * 60 * 1000,
  }

  assert.equal(isInactivityFollowUpDue(session, now), true)
  assert.equal(isInactivityFollowUpDue({ ...session, inactivityFollowUpSentAt: now }, now), false)
  assert.equal(isInactivityFollowUpDue({ ...session, booking: null }, now), false)
  assert.equal(isInactivityFollowUpDue({ ...session, transferHandoffAt: now }, now), false)
  assert.equal(isInactivityFollowUpDue({ ...session, humanTakeoverLock: { assignee: 'human' } }, now), false)
})

test('follow-up keeps the supplied flow continuation in the customer language', () => {
  assert.match(
    buildInactivityFollowUpMessage({
      customerLanguage: 'Latin American Spanish',
      continuation: '¿En qué estado vives?',
    }),
    /todavía te interesa[\s\S]*¿En qué estado vives\?/i,
  )
})

