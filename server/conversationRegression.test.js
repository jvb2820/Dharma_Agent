import test from 'node:test'
import assert from 'node:assert/strict'

import { chooseConfirmedState, hasStrictRequestedDay } from '../src/utils/bookingRules.js'
import { detectLatestMessageLanguage, resolveLatestMessageLanguage } from '../src/utils/conversationLanguage.js'
import { formatCustomerStateSlot, getStateTimeZone } from './timezones.js'

test('latest Spanish scheduling messages override an earlier English language', () => {
  for (const message of ['No, puedo el sabado', 'No, mas tarde el sabado', 'Solo puedo el sabado']) {
    assert.equal(resolveLatestMessageLanguage(message, 'English'), 'Latin American Spanish')
  }
})

test('a Spanish denial of Portuguese is classified as Spanish', () => {
  assert.equal(detectLatestMessageLanguage('No hablo portugués'), 'Latin American Spanish')
  assert.equal(detectLatestMessageLanguage('Y cual fue el tratamento que ella utilizó?'), 'Latin American Spanish')
})

test('the active confirmed state beats stale profile and historical states', () => {
  assert.equal(chooseConfirmedState({
    activeState: 'California',
    profileState: 'Massachusetts',
    historicalState: 'Massachusetts',
  }), 'California')
})

test('only an explicit latest-message state changes the active state', () => {
  assert.equal(chooseConfirmedState({ latestState: 'Nevada', activeState: 'California' }), 'Nevada')
  assert.equal(chooseConfirmedState({ activeState: 'California', profileState: 'Massachusetts' }), 'California')
})

test('Saturday and explicit dates are hard availability constraints', () => {
  assert.equal(hasStrictRequestedDay('sábado afternoon'), true)
  assert.equal(hasStrictRequestedDay('Saturday'), true)
  assert.equal(hasStrictRequestedDay('Jul 25'), true)
  assert.equal(hasStrictRequestedDay('later'), false)
})

test('California slots are formatted in California local time', () => {
  assert.equal(getStateTimeZone('California'), 'America/Los_Angeles')
  assert.match(formatCustomerStateSlot(Date.UTC(2026, 6, 25, 19, 0), 'California'), /12:00 PM California Time/)
})
