import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildPostBookingLock,
  isPostBookingLockActive,
  isPostBookingLockExpired,
} from './postBookingLockService.js'

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
