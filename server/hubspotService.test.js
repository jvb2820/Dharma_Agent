import test from 'node:test'
import assert from 'node:assert/strict'

import { buildBookingDealProperties } from './hubspotService.js'

const bookingInput = {
  seller: {
    slug: 'test-seller',
    fieldValue: 'Test Seller',
  },
  option: {
    startTime: 1780000000000,
  },
  meeting: {
    id: 'test-meeting',
    properties: {
      hubspot_owner_id: 'test-owner',
    },
  },
}

test('booking deals include the customer phone number', () => {
  const properties = buildBookingDealProperties({
    ...bookingInput,
    customer: {
      firstName: 'Test',
      lastName: 'Customer',
      email: '13478665207@dummy.com',
      phone: '+1 (347) 866-5207',
      desiredTreatment: 'Compounded Semaglutide',
    },
  })

  assert.equal(properties.phone, '+1 (347) 866-5207')
})

test('booking deals omit an unavailable customer phone number', () => {
  const properties = buildBookingDealProperties({
    ...bookingInput,
    customer: {
      firstName: 'Recurring',
      lastName: 'Customer',
      email: 'recurring@example.com',
      phone: '',
      desiredTreatment: 'Compounded Semaglutide',
    },
  })

  assert.equal('phone' in properties, false)
})
