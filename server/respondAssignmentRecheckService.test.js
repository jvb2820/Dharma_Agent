import test from 'node:test'
import assert from 'node:assert/strict'

import { recheckRespondAssignment } from './respondAssignmentRecheckService.js'

const assigned = (assignee = 'human@example.com') => ({ conversation: { assignee } })
const unassigned = () => ({ conversation: {} })
const isAssigned = (profile) => Boolean(profile?.conversation?.assignee)

test('does not delay or reload a contact that is already unassigned', async () => {
  let loads = 0
  let delays = 0

  const result = await recheckRespondAssignment({
    initialProfile: unassigned(),
    isAssigned,
    loadProfile: async () => {
      loads += 1
      return assigned()
    },
    delay: async () => { delays += 1 },
  })

  assert.equal(result.rechecked, false)
  assert.equal(result.released, false)
  assert.equal(loads, 0)
  assert.equal(delays, 0)
})

test('resumes the original message after the workflow unassigns the contact', async () => {
  const profiles = [assigned(), unassigned()]

  const result = await recheckRespondAssignment({
    initialProfile: assigned(),
    isAssigned,
    loadProfile: async () => profiles.shift(),
    delay: async () => {},
    delayMs: 0,
    attempts: 3,
  })

  assert.equal(result.rechecked, true)
  assert.equal(result.released, true)
  assert.equal(result.attempts, 2)
  assert.equal(isAssigned(result.profile), false)
})

test('preserves human ownership when the assignment remains after all rechecks', async () => {
  let loads = 0

  const result = await recheckRespondAssignment({
    initialProfile: assigned(),
    isAssigned,
    loadProfile: async () => {
      loads += 1
      return assigned()
    },
    delay: async () => {},
    delayMs: 0,
    attempts: 3,
  })

  assert.equal(result.rechecked, true)
  assert.equal(result.released, false)
  assert.equal(result.attempts, 3)
  assert.equal(loads, 3)
  assert.equal(isAssigned(result.profile), true)
})
