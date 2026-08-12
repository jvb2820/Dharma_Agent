import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getAvailabilityMonthOffsets,
  getConfiguredCustomerServiceTeam,
  getConfiguredNewClientBookingTeam,
  getConfiguredPrioritySellers,
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
