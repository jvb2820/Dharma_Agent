import test from 'node:test'
import assert from 'node:assert/strict'

import { buildBookingAttemptKey } from './bookingFailureService.js'

test('booking failures use a stable contact, specialist, and slot attempt key', () => {
  assert.equal(
    buildBookingAttemptKey('123', { sellerSlug: 'seller-one', startTime: 1788015600000 }),
    '123:seller-one:1788015600000',
  )
})
