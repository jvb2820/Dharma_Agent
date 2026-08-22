import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildPostBookingLock,
  isPostBookingLockActive,
  isPostBookingLockExpired,
  shouldRestorePostBookingAssignee,
} from './postBookingLockService.js'

test('post-booking locks can be disabled for testing', () => {
  const original = process.env.RESPOND_POST_BOOKING_LOCK_ENABLED
  process.env.RESPOND_POST_BOOKING_LOCK_ENABLED = 'false'
  try {
    assert.equal(buildPostBookingLock({
      contactId: 'contact-1',
      assignee: 'seller-1',
      option: { startTime: Date.now() + 60_000, duration: 20 * 60_000 },
    }), null)
  } finally {
    if (original == null) delete process.env.RESPOND_POST_BOOKING_LOCK_ENABLED
    else process.env.RESPOND_POST_BOOKING_LOCK_ENABLED = original
  }
})

test('post-booking lock lasts until the meeting end plus grace period', () => {
  const previousGrace = process.env.RESPOND_POST_BOOKING_GRACE_MINUTES
  process.env.RESPOND_POST_BOOKING_GRACE_MINUTES = '60'
  const start = Date.UTC(2026, 6, 24, 13, 40)
  const end = start + 20 * 60 * 1000
  const lock = buildPostBookingLock({
    contactId: '202093615',
    assignee: 'specialist@example.com',
    booked: { calendarEventId: 'event-1' },
    option: { startTime: start, endTime: end, duration: 20 * 60 * 1000 },
  })

  assert.equal(lock.meetingStartAt, start)
  assert.equal(lock.meetingEndAt, end)
  assert.equal(lock.lockedUntil, end + 60 * 60 * 1000)
  assert.equal(isPostBookingLockActive(lock, end), true)
  assert.equal(isPostBookingLockExpired(lock, lock.lockedUntil), true)

  if (previousGrace == null) delete process.env.RESPOND_POST_BOOKING_GRACE_MINUTES
  else process.env.RESPOND_POST_BOOKING_GRACE_MINUTES = previousGrace
})

test('a lock is not created without successful assignment data or meeting time', () => {
  assert.equal(buildPostBookingLock({ contactId: '1', option: { startTime: Date.now() } }), null)
  assert.equal(buildPostBookingLock({ contactId: '1', assignee: 'agent' }), null)
})

test('active post-booking ownership is restored when a workflow unassigns or changes the assignee', () => {
  const lock = { status: 'active', assignee: 'emorales@dharmanutritionclinic.com' }

  assert.equal(shouldRestorePostBookingAssignee({ lock, currentAssignee: '' }), true)
  assert.equal(shouldRestorePostBookingAssignee({ lock, currentAssignee: 'laura@dharmanutritionclinic.com' }), true)
  assert.equal(shouldRestorePostBookingAssignee({ lock, currentAssignee: 'EMORALES@dharmanutritionclinic.com' }), false)
  assert.equal(shouldRestorePostBookingAssignee({ lock, currentAssignee: '', conversationClosed: true }), false)
})
