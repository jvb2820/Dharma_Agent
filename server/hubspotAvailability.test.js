import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getAvailabilityMonthOffsets,
  getConfiguredCustomerServiceTeam,
  getConfiguredNewClientBookingTeam,
  getConfiguredPrioritySellers,
  parsePreferredWeekdays,
  parsePreferredTime,
} from './hubspotService.js'

test('new-client booking pool includes sellers and Customer Service specialists', () => {
  const pool = getConfiguredNewClientBookingTeam()
  const sellers = getConfiguredPrioritySellers()
  const customerService = getConfiguredCustomerServiceTeam()

  assert.deepEqual(
    pool.filter((member) => member.bookingTeam === 'sales').map((member) => member.slug),
    sellers.map((member) => member.slug),
  )
  assert.deepEqual(
    pool.filter((member) => member.bookingTeam === 'customer_service').map((member) => member.slug),
    customerService.map((member) => member.slug),
  )
})

test('Ailin Isabel is configured as a seller', () => {
  const ailin = getConfiguredPrioritySellers().find(
    (member) => member.fieldValue === 'Ailin Isabel',
  )

  assert.deepEqual(ailin, {
    slug: 'ailin-isabel',
    name: 'Ailin',
    fieldValue: 'Ailin Isabel',
  })
  assert.equal(
    getConfiguredNewClientBookingTeam().find((member) => member.slug === 'ailin-isabel')?.bookingTeam,
    'sales',
  )
})

test('Aline Strelow uses her 20-minute Customer Service meeting page', () => {
  const aline = getConfiguredCustomerServiceTeam().find(
    (member) => member.fieldValue === 'Aline Strelow',
  )

  assert.deepEqual(aline, {
    slug: 'aline-strelow',
    name: 'Aline',
    fieldValue: 'Aline Strelow',
  })
  assert.equal(
    getConfiguredNewClientBookingTeam().find((member) => member.slug === 'aline-strelow')?.bookingTeam,
    'customer_service',
  )
})

test('weekday availability searches current and following HubSpot month pages', () => {
  assert.deepEqual(getAvailabilityMonthOffsets({ dateKey: '' }, 6, 'UTC'), [0, 1])
})

test('general availability searches current and following HubSpot month pages', () => {
  assert.deepEqual(getAvailabilityMonthOffsets({ dateKey: '' }, null, 'UTC'), [0, 1])
})

test('availability with an explicit date searches only the target month page', () => {
  assert.equal(getAvailabilityMonthOffsets({ dateKey: '2099-08-01' }, 6, 'UTC').length, 1)
})

test('preferred appointment times accept colon and dot minute separators', () => {
  assert.deepEqual(parsePreferredTime('around 10:30 am', 'America/New_York'), {
    dateKey: '',
    hour: 10,
    minute: 30,
  })
  assert.deepEqual(parsePreferredTime('sobre 10.30 am', 'America/New_York'), {
    dateKey: '',
    hour: 10,
    minute: 30,
  })
})

test('next week creates a strict minimum date and searches across month boundaries', () => {
  const preference = parsePreferredTime('I am only available next week', 'America/New_York')

  assert.equal(preference.dateKey, '')
  assert.match(preference.minimumDateKey, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(preference.minimumDateKey > new Date().toISOString().slice(0, 10))
  assert.equal(getAvailabilityMonthOffsets(preference, null, 'America/New_York').length, 2)
})

test('month-only availability is a strict range on one HubSpot month page', () => {
  const preference = parsePreferredTime('for September', 'America/New_York')

  assert.match(preference.monthStartKey, /^\d{4}-09-01$/)
  assert.equal(preference.minimumDateKey, preference.monthStartKey)
  assert.match(preference.maximumDateKey, /^\d{4}-09-30$/)
  assert.equal(getAvailabilityMonthOffsets(preference, null, 'America/New_York').length, 1)
})

test('past month names roll into the following calendar year', () => {
  const preference = parsePreferredTime('January', 'UTC')
  const now = new Date()
  const expectedYear = now.getUTCMonth() + 1 > 1 ? now.getUTCFullYear() + 1 : now.getUTCFullYear()

  assert.equal(preference.monthStartKey, `${expectedYear}-01-01`)
  assert.equal(preference.maximumDateKey, `${expectedYear}-01-31`)
})

test('Spanish day-month phrases become exact requested dates', () => {
  const preference = parsePreferredTime('lunes 24 de agosto en la mañana', 'America/New_York')
  const currentYear = Number(new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    timeZone: 'America/New_York',
  }).format(new Date()))
  const expectedYear = new Date().getMonth() + 1 > 8 ? currentYear + 1 : currentYear

  assert.equal(preference.dateKey, `${expectedYear}-08-24`)
  assert.equal(preference.monthStartKey, undefined)
})

test('multiple acceptable weekdays are preserved', () => {
  assert.deepEqual(parsePreferredWeekdays('cualquier lunes o domingo'), [0, 1])
  assert.deepEqual(parsePreferredWeekdays('Monday or Sunday'), [0, 1])
})
