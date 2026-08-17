import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveBookedScheduledAt } from './booked.js'

test('customer confirmation prefers the verified HubSpot timestamp', () => {
  const offered = Date.UTC(2026, 7, 18, 18, 40)
  const confirmed = Date.UTC(2026, 7, 17, 18, 40)

  assert.equal(resolveBookedScheduledAt({
    option: { startTime: offered },
    booked: { confirmedStartTime: confirmed },
  }), confirmed)
})
