import test from 'node:test'
import assert from 'node:assert/strict'

import { getSlotClaimKey } from './slotClaimService.js'

test('slot claims are unique per specialist and start time', () => {
  assert.equal(getSlotClaimKey({ sellerSlug: 'laura', startTime: 1787000400000 }), 'laura:1787000400000')
  assert.notEqual(
    getSlotClaimKey({ sellerSlug: 'laura', startTime: 1787000400000 }),
    getSlotClaimKey({ sellerSlug: 'william', startTime: 1787000400000 }),
  )
})

test('invalid appointment options cannot produce a slot claim key', () => {
  assert.equal(getSlotClaimKey({ sellerSlug: '', startTime: 1787000400000 }), '')
  assert.equal(getSlotClaimKey({ sellerSlug: 'laura', startTime: 'invalid' }), '')
})
