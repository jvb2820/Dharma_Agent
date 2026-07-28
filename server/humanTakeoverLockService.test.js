import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildHumanTakeoverLock,
  closeHumanTakeoverLock,
  isHumanTakeoverLockActive,
  isHumanTakeoverLockExpired,
} from './humanTakeoverLockService.js'

test('an assigned human-takeover lock remains active without a fixed expiry', () => {
  const lock = buildHumanTakeoverLock({
    contactId: 'contact-1',
    assignee: 'human@example.com',
    assignedAt: 1000,
  })

  assert.equal(lock.phase, 'assigned')
  assert.equal(lock.lockedUntil, 0)
  assert.equal(isHumanTakeoverLockActive(lock, Date.now() + 365 * 24 * 60 * 60 * 1000), true)
})

test('closing a human takeover starts the configured 24-hour cooldown', () => {
  const previousGrace = process.env.RESPOND_HUMAN_TAKEOVER_GRACE_MINUTES
  process.env.RESPOND_HUMAN_TAKEOVER_GRACE_MINUTES = '1440'
  const assigned = buildHumanTakeoverLock({
    contactId: 'contact-2',
    assignee: 'human@example.com',
    assignedAt: 1000,
  })
  const closedAt = Date.UTC(2026, 6, 29, 12)
  const lock = closeHumanTakeoverLock(assigned, closedAt)

  assert.equal(lock.phase, 'cooldown')
  assert.equal(lock.lockedUntil, closedAt + 24 * 60 * 60 * 1000)
  assert.equal(isHumanTakeoverLockActive(lock, lock.lockedUntil - 1), true)
  assert.equal(isHumanTakeoverLockExpired(lock, lock.lockedUntil), true)

  if (previousGrace == null) delete process.env.RESPOND_HUMAN_TAKEOVER_GRACE_MINUTES
  else process.env.RESPOND_HUMAN_TAKEOVER_GRACE_MINUTES = previousGrace
})

test('a human-takeover lock requires both contact and assignee', () => {
  assert.equal(buildHumanTakeoverLock({ contactId: 'contact-3' }), null)
  assert.equal(buildHumanTakeoverLock({ assignee: 'human@example.com' }), null)
})
