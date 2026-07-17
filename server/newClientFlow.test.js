import test from 'node:test'
import assert from 'node:assert/strict'

import {
  hasConfirmedFullName,
  isExactRespondClientStatus,
  shouldUseNewClientBookingFlow,
  splitCustomerFullName,
} from './newClientFlow.js'

test('exact Client status uses the recurring-client flow', () => {
  const profile = { fields: { contactStatus: 'Client' } }

  assert.equal(isExactRespondClientStatus(profile), true)
  assert.equal(shouldUseNewClientBookingFlow(profile), false)
})

test('recurring clients do not need a confirmed full name', () => {
  const profile = { fields: { contactStatus: ' Client ' } }
  const requiresName = shouldUseNewClientBookingFlow(profile) && !hasConfirmedFullName({})

  assert.equal(requiresName, false)
})

test('returning leads and non-client statuses remain in the new-client flow', () => {
  for (const profile of [
    { status: 'returning_lead', fields: { contactStatus: 'Lead' } },
    { fields: { contactStatus: 'Evaluation Scheduled' } },
    { fields: { contactStatus: '' } },
  ]) {
    assert.equal(isExactRespondClientStatus(profile), false)
    assert.equal(shouldUseNewClientBookingFlow(profile), true)
  }
})

test('exact client status fallback is recognized when supplied by profile classification', () => {
  const profile = { exactContactStatus: 'Client' }

  assert.equal(isExactRespondClientStatus(profile), true)
  assert.equal(shouldUseNewClientBookingFlow(profile), false)
})

test('booking phrases are never accepted as customer names', () => {
  for (const phrase of ['y para hoy', 'para mañana', 'quiero precios', 'e para hoje']) {
    assert.deepEqual(splitCustomerFullName(phrase), {})
  }
})
