import test from 'node:test'
import assert from 'node:assert/strict'

import {
  compareAvailabilityOptions,
  getAvailabilityMonthOffsets,
  getConfiguredCustomerServiceTeam,
  getConfiguredNewClientBookingTeam,
  getConfiguredPrioritySellers,
  parsePreferredWeekdays,
  parsePreferredTime,
  resolveBookingTeamForOption,
} from './hubspotService.js'

test('combined booking pool chooses the earliest slot regardless of team', () => {
  const options = [
    { sellerName: 'Seller', bookingTeam: 'sales', startTime: 2000, sellerPriority: 0 },
    { sellerName: 'CS', bookingTeam: 'customer_service', startTime: 1000, sellerPriority: 5 },
  ]

  options.sort((left, right) => compareAvailabilityOptions(left, right, {}, 'UTC'))

  assert.equal(options[0].sellerName, 'CS')
})

test('requested time proximity ranks both booking teams equally', () => {
  const options = [
    { sellerName: 'Seller', bookingTeam: 'sales', startTime: Date.UTC(2026, 0, 1, 16), sellerPriority: 0 },
    { sellerName: 'CS', bookingTeam: 'customer_service', startTime: Date.UTC(2026, 0, 1, 15), sellerPriority: 5 },
  ]
  const preference = { hour: 10, minute: 0 }

  options.sort((left, right) => compareAvailabilityOptions(left, right, preference, 'America/New_York'))

  assert.equal(options[0].sellerName, 'CS')
})

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

test('persisted options recover their booking team from the specialist slug', () => {
  assert.equal(resolveBookingTeamForOption({ sellerSlug: 'aline-strelow' }, 'sales'), 'customer_service')
  assert.equal(resolveBookingTeamForOption({ sellerSlug: 'meribet-yazziet' }, 'customer_service'), 'sales')
})

test('Ailin Isabel is not in the active seller pool', () => {
  assert.equal(
    getConfiguredPrioritySellers().some((member) => member.slug === 'ailin-isabel'),
    false,
  )
  assert.equal(
    getConfiguredNewClientBookingTeam().some((member) => member.slug === 'ailin-isabel'),
    false,
  )
})

test('Erika Vargas is configured as a seller', () => {
  const erika = getConfiguredPrioritySellers().find(
    (member) => member.slug === 'evargas22',
  )

  assert.deepEqual(erika, {
    slug: 'evargas22',
    name: 'Erika',
    fieldValue: 'Erika Vargas',
  })
  assert.equal(
    getConfiguredNewClientBookingTeam().find((member) => member.slug === 'evargas22')?.bookingTeam,
    'sales',
  )
})

test('Alejandro Rivera is not in the active seller pool', () => {
  assert.equal(
    getConfiguredPrioritySellers().some((member) => member.slug === 'alejandro667'),
    false,
  )
  assert.equal(
    getConfiguredNewClientBookingTeam().some((member) => member.slug === 'alejandro667'),
    false,
  )
})

test('Andres Castro is not in the active seller pool', () => {
  assert.equal(
    getConfiguredPrioritySellers().some((member) => member.slug === 'acastro29'),
    false,
  )
  assert.equal(
    getConfiguredNewClientBookingTeam().some((member) => member.slug === 'acastro29'),
    false,
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

test('Spanish day-month phrases become exact requested dates', (testContext) => {
  testContext.mock.method(Date, 'now', () => Date.UTC(2026, 7, 20, 12))
  const preference = parsePreferredTime('lunes 24 de agosto en la mañana', 'America/New_York')
  assert.equal(preference.dateKey, '2026-08-24')
  assert.equal(preference.monthStartKey, undefined)
})

test('multiple acceptable weekdays are preserved', () => {
  assert.deepEqual(parsePreferredWeekdays('cualquier lunes o domingo'), [0, 1])
  assert.deepEqual(parsePreferredWeekdays('Monday or Sunday'), [0, 1])
})
