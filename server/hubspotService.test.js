import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildBookingDealProperties,
  formatHubSpotWorkflowAppointmentTime,
  formatUsPhoneForHubSpot,
} from './hubspotService.js'

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

test('confirmation workflow time is written explicitly in Florida time', () => {
  assert.equal(
    formatHubSpotWorkflowAppointmentTime(Date.UTC(2026, 6, 27, 15, 20)),
    'July 27, 2026 11:20 AM',
  )
})

test('HubSpot phone values are normalized to the US display format', () => {
  for (const input of [
    '19547981563',
    '9547981563',
    '+1 954-798-1563',
    '(954) 798 1563',
  ]) {
    assert.equal(formatUsPhoneForHubSpot(input), '+1 (954) 798-1563')
  }
})

test('deal phone is normalized even when the customer provides raw digits', () => {
  const properties = buildBookingDealProperties({
    ...bookingInput,
    customer: {
      firstName: 'Test',
      lastName: 'Customer',
      email: '19547981563@dummy.com',
      phone: '19547981563',
      desiredTreatment: 'Compounded Semaglutide',
    },
  })

  assert.equal(properties.phone, '+1 (954) 798-1563')
})
