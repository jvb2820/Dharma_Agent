import assert from 'node:assert/strict'
import test from 'node:test'
import { isTransientBookingError } from './bookingReliabilityService.js'

test('retries only temporary booking failures', () => {
  assert.equal(isTransientBookingError({ status: 503, message: 'service unavailable' }), true)
  assert.equal(isTransientBookingError(new Error('network timeout')), true)
  assert.equal(isTransientBookingError({ status: 400, message: 'invalid phone number' }), false)
  assert.equal(isTransientBookingError({ status: 401, message: 'unauthorized' }), false)
})
