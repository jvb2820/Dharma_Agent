import test from 'node:test'
import assert from 'node:assert/strict'

import { buildPersistedSlotClaim, getSlotClaimKey, getSlotClaimTtlSeconds } from './slotClaimService.js'

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

test('slot claim TTL defaults to three minutes and rejects unsafe short values', () => {
  const original = process.env.RESPOND_SLOT_CLAIM_TTL_SECONDS
  delete process.env.RESPOND_SLOT_CLAIM_TTL_SECONDS
  assert.equal(getSlotClaimTtlSeconds(), 180)
  process.env.RESPOND_SLOT_CLAIM_TTL_SECONDS = '10'
  assert.equal(getSlotClaimTtlSeconds(), 180)
  process.env.RESPOND_SLOT_CLAIM_TTL_SECONDS = '300'
  assert.equal(getSlotClaimTtlSeconds(), 300)
  if (original === undefined) delete process.env.RESPOND_SLOT_CLAIM_TTL_SECONDS
  else process.env.RESPOND_SLOT_CLAIM_TTL_SECONDS = original
})

test('accepted slot claim metadata can be persisted and renewed across messages', () => {
  const first = buildPersistedSlotClaim({
    slotKey: 'aline-strelow:1787000400000',
    claimedAt: 1000,
    expiresAt: '2026-08-17T12:03:00.000Z',
    persisted: true,
  }, 'contact-123')
  const renewed = buildPersistedSlotClaim({
    ...first,
    claimedAt: 2000,
    expiresAt: '2026-08-17T12:06:00.000Z',
  }, first.contactId)

  assert.equal(renewed.slotKey, first.slotKey)
  assert.equal(renewed.contactId, 'contact-123')
  assert.equal(renewed.claimedAt, 2000)
  assert.equal(renewed.expiresAt, '2026-08-17T12:06:00.000Z')
  assert.equal(renewed.persisted, true)
})
