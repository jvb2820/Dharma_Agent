import test from 'node:test'
import assert from 'node:assert/strict'

import {
  extractUsPhoneNumber,
  hasConfirmedFullName,
  isExactRespondClientStatus,
  isUsCountryCodePhone,
  normalizeUsPhoneNumber,
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

test('full names are accepted after a conversational affirmation', () => {
  for (const reply of ['Si Sandra Zertuche', 'Sí, Sandra Zertuche', 'Yes Sandra Zertuche']) {
    assert.deepEqual(splitCustomerFullName(reply), {
      firstName: 'Sandra',
      lastName: 'Zertuche',
      nameConfirmed: true,
    })
  }
})

test('a resend reminder is never accepted as a customer name', () => {
  for (const reply of ['Ya se lo mande', 'Ya se lo envié', 'I already sent it']) {
    assert.deepEqual(splitCustomerFullName(reply), {})
  }
})

test('new-client phone accepts US numbers with an optional country code', () => {
  assert.equal(isUsCountryCodePhone('+1 (347) 866-5207'), true)
  assert.equal(isUsCountryCodePhone('13478665207'), true)
  assert.equal(isUsCountryCodePhone('(347) 866-5207'), true)
  assert.equal(isUsCountryCodePhone('801 574 9966'), true)
  assert.equal(isUsCountryCodePhone('+52 55 1234 5678'), false)
  assert.equal(isUsCountryCodePhone(''), false)
})

test('extracts a US phone number when its final digits are unusually spaced', () => {
  assert.equal(extractUsPhoneNumber('323 975 52 92'), '323 975 52 92')
  assert.equal(normalizeUsPhoneNumber(extractUsPhoneNumber('Mi numero es 323 975 52 92')), '13239755292')
})

test('does not extract international or incomplete numbers as US phone numbers', () => {
  assert.equal(extractUsPhoneNumber('+52 55 1234 5678'), '')
  assert.equal(extractUsPhoneNumber('323 975 529'), '')
})

test('US phone numbers are normalized with a leading 1 for booking and dummy email', () => {
  assert.equal(normalizeUsPhoneNumber('801 574 9966'), '18015749966')
  assert.equal(normalizeUsPhoneNumber('1 801 574 9966'), '18015749966')
  assert.equal(normalizeUsPhoneNumber('+1 (801) 574-9966'), '18015749966')
  assert.equal(normalizeUsPhoneNumber('+52 55 1234 5678'), '')
})
