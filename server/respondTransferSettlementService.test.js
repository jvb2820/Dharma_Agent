import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPendingRespondTransfer,
  isPendingRespondTransferActive,
  settleRespondTransferAssignment,
} from './respondTransferSettlementService.js'

test('pending transfer remains active only during its settlement window', () => {
  const previous = process.env.RESPOND_TRANSFER_SETTLEMENT_DELAY_MS
  process.env.RESPOND_TRANSFER_SETTLEMENT_DELAY_MS = '30000'
  try {
    const pending = buildPendingRespondTransfer({ triggerType: 'unsupported_voice_message', now: 1_000 })
    assert.equal(pending.settleAt, 31_000)
    assert.equal(isPendingRespondTransferActive(pending, 30_999), true)
    assert.equal(isPendingRespondTransferActive(pending, 31_000), false)
  } finally {
    if (previous === undefined) delete process.env.RESPOND_TRANSFER_SETTLEMENT_DELAY_MS
    else process.env.RESPOND_TRANSFER_SETTLEMENT_DELAY_MS = previous
  }
})

test('waits for workflow settlement and assigns when the contact finishes unassigned', async () => {
  const calls = []
  const result = await settleRespondTransferAssignment({
    contactId: 'contact-1',
    assignees: ['laura'],
    delayMs: 30_000,
    delay: async (ms) => calls.push(['delay', ms]),
    loadProfile: async () => ({ conversation: {} }),
    getAssignee: (profile) => profile.conversation.assignee || '',
    assign: async (assignment) => calls.push(['assign', assignment]),
  })

  assert.deepEqual(calls, [
    ['delay', 30_000],
    ['assign', { contactId: 'contact-1', assignee: 'laura' }],
  ])
  assert.equal(result.assignee, 'laura')
  assert.equal(result.retained, false)
})

test('keeps an existing target-team assignment after workflow settlement', async () => {
  let assignmentCalls = 0
  const result = await settleRespondTransferAssignment({
    contactId: 'contact-2',
    assignees: ['william', 'laura'],
    delay: async () => {},
    loadProfile: async () => ({ conversation: { assignee: 'william' } }),
    getAssignee: (profile) => profile.conversation.assignee || '',
    assign: async () => { assignmentCalls += 1 },
  })

  assert.equal(assignmentCalls, 0)
  assert.equal(result.assignee, 'william')
  assert.equal(result.retained, true)
})

test('previous-owner restoration preserves another human who takes ownership during the wait', async () => {
  let assignmentCalls = 0
  const result = await settleRespondTransferAssignment({
    contactId: 'contact-3',
    assignees: ['william'],
    delay: async () => {},
    loadProfile: async () => ({ conversation: { assignee: 'laura' } }),
    getAssignee: (profile) => profile.conversation.assignee || '',
    assign: async () => { assignmentCalls += 1 },
    preserveAnyExistingAssignee: true,
  })

  assert.equal(assignmentCalls, 0)
  assert.equal(result.assignee, 'laura')
  assert.equal(result.retained, true)
})
