import test from 'node:test'
import assert from 'node:assert/strict'

import {
  chooseConfirmedState,
  getMinimumStartAfterSlotRejection,
  getNextPreferenceAfterRejectedRelativeDay,
  hasStrictRequestedDay,
  rejectsOfferedCalendarDate,
  resolveKansasLocationClarification,
} from '../src/utils/bookingRules.js'
import { detectLatestMessageLanguage, resolveLatestMessageLanguage } from '../src/utils/conversationLanguage.js'
import { formatCustomerStateSlot, getStateTimeZone } from './timezones.js'
import { applyDefaultAvailabilityRule } from '../src/utils/availabilityRules.js'

test('latest Spanish scheduling messages override an earlier English language', () => {
  for (const message of [
    'No, puedo el sabado',
    'No, mas tarde el sabado',
    'Solo puedo el sabado',
    'en nevada',
    'quiero saber el precio',
    'yo soy hipertensa',
    'Tiene a las 12pm de california?',
  ]) {
    assert.equal(resolveLatestMessageLanguage(message, 'English'), 'Latin American Spanish')
  }
})

test('the latest customer message controls English, Spanish, and Portuguese replies', () => {
  const cases = [
    { message: "I can't tomorrow", fallback: 'Portuguese', expected: 'English' },
    { message: 'Mañana no puedo', fallback: 'English', expected: 'Latin American Spanish' },
    { message: 'Amanhã não posso', fallback: 'Latin American Spanish', expected: 'Portuguese' },
  ]

  for (const { message, fallback, expected } of cases) {
    assert.equal(detectLatestMessageLanguage(message), expected)
    assert.equal(resolveLatestMessageLanguage(message, fallback), expected)
    assert.equal(getNextPreferenceAfterRejectedRelativeDay(message), 'day after tomorrow')
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

test('Kansas location ambiguity pauses state confirmation until resolved', () => {
  assert.deepEqual(resolveKansasLocationClarification('Kansas'), {
    state: '',
    needsClarification: true,
  })
  assert.deepEqual(resolveKansasLocationClarification('Kansas City'), {
    state: '',
    needsClarification: true,
  })
  assert.equal(resolveKansasLocationClarification('Missouri', true).state, 'Missouri')
  assert.equal(resolveKansasLocationClarification('Kansas', true).state, 'Kansas')
})

test('explicit Kansas locations bypass clarification safely', () => {
  assert.equal(resolveKansasLocationClarification('Kansas City, Missouri').state, 'Missouri')
  assert.equal(resolveKansasLocationClarification('Kansas City, Kansas').state, 'Kansas')
  assert.equal(resolveKansasLocationClarification('state of Kansas').state, 'Kansas')
  assert.equal(resolveKansasLocationClarification('Colorado').needsClarification, false)
})

test('Saturday and explicit dates are hard availability constraints', () => {
  assert.equal(hasStrictRequestedDay('sábado afternoon'), true)
  assert.equal(hasStrictRequestedDay('Saturday'), true)
  assert.equal(hasStrictRequestedDay('Jul 25'), true)
  assert.equal(hasStrictRequestedDay('later'), false)
})

test('a rejected relative date rejects the whole offered calendar day', () => {
  assert.equal(rejectsOfferedCalendarDate('Mañana no puedo'), true)
  assert.equal(rejectsOfferedCalendarDate("I can't make Thursday"), true)
  assert.equal(rejectsOfferedCalendarDate('Amanhã não posso'), true)
  assert.equal(rejectsOfferedCalendarDate('11:00 no me funciona'), false)
})

test('a rejected relative day advances scheduling instead of searching it again', () => {
  for (const message of [
    'Mañana no puedo',
    "I can't tomorrow",
    'Amanhã não posso',
  ]) {
    assert.equal(getNextPreferenceAfterRejectedRelativeDay(message), 'day after tomorrow')
  }

  assert.equal(getNextPreferenceAfterRejectedRelativeDay("I can't today"), 'tomorrow')
  assert.equal(getNextPreferenceAfterRejectedRelativeDay('Tomorrow works for me'), '')
})

test('a rejected time moves the next offer at least three hours later', () => {
  const offeredStart = Date.UTC(2026, 6, 24, 16, 20)

  assert.equal(
    getMinimumStartAfterSlotRejection('No puedo esa hora', offeredStart),
    Date.UTC(2026, 6, 24, 19, 20),
  )
  assert.equal(getMinimumStartAfterSlotRejection('No puedo hoy', offeredStart), undefined)
})

test('plural weekday preferences are strict calendar constraints', () => {
  assert.equal(hasStrictRequestedDay('solo puedo los sábados'), true)
  assert.equal(hasStrictRequestedDay('Saturdays only'), true)
})

test('California slots are formatted in California local time', () => {
  assert.equal(getStateTimeZone('California'), 'America/Los_Angeles')
  assert.match(formatCustomerStateSlot(Date.UTC(2026, 6, 25, 19, 0), 'California'), /12:00 PM California Time/)
})

test('customer-facing slots localize the complete date and timezone label', () => {
  const timestamp = Date.UTC(2026, 6, 23, 16, 0)
  const english = formatCustomerStateSlot(timestamp, 'Missouri', 'America/Chicago', 'English')
  const spanish = formatCustomerStateSlot(timestamp, 'Missouri', 'America/Chicago', 'Latin American Spanish')
  const portuguese = formatCustomerStateSlot(timestamp, 'Missouri', 'America/Chicago', 'Portuguese')

  assert.match(english, /Thursday/i)
  assert.match(english, /Missouri Time/)
  assert.match(spanish, /jueves/i)
  assert.match(spanish, /Hora de Missouri/)
  assert.doesNotMatch(spanish, /Thursday|Missouri Time/)
  assert.match(portuguese, /quinta-feira/i)
  assert.match(portuguese, /Horário de Missouri/)
})

test('availability defaults to 9 AM but explicit early requests override it', () => {
  assert.equal(applyDefaultAvailabilityRule({}, '').earliestHour, 9)
  assert.equal(applyDefaultAvailabilityRule({}, '7:00 AM').earliestHour, 7)
  assert.equal(applyDefaultAvailabilityRule({}, '12:00 PM').earliestHour, 12)
})

test('an earlier request removes the default 9 AM lower bound', () => {
  const result = applyDefaultAvailabilityRule({
    earliestHour: 9,
    direction: 'earlier',
    allowBeforeDefaultStart: true,
    latestStartTime: Date.UTC(2026, 6, 23, 16, 20),
  })
  assert.equal(result.earliestHour, undefined)
  assert.equal(result.latestStartTime, Date.UTC(2026, 6, 23, 16, 20))
})
