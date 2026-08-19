import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assertConfirmedMeetingMatchesOption,
  buildBookingDealProperties,
  buildBookingFormFields,
  formatHubSpotWorkflowAppointmentTime,
  formatUsPhoneForHubSpot,
} from './hubspotService.js'

test('rejects a HubSpot meeting confirmed on a different date', () => {
  const expected = Date.UTC(2026, 7, 18, 18, 40)
  const wrongDate = Date.UTC(2026, 7, 17, 18, 40)

  assert.throws(
    () => assertConfirmedMeetingMatchesOption(expected, wrongDate),
    (error) => error.category === 'confirmed_time_mismatch' &&
      error.expectedStartTime === expected && error.confirmedStartTime === wrongDate,
  )
  assert.equal(assertConfirmedMeetingMatchesOption(expected, expected), expected)
})

test('HubSpot meeting bookings always request native deal creation', () => {
  const fields = buildBookingFormFields({
    customer: { desiredTreatment: 'Supplements' },
    seller: { fieldValue: 'Test Seller' },
    supportedFormFieldNames: ['create_deal', 'agent_lead_management', 'desired_treatment'],
  })

  assert.deepEqual(fields.find(({ name }) => name === 'create_deal'), {
    name: 'create_deal',
    value: 'true',
  })
})

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
      hs_meeting_start_time: '2026-05-28T10:40:00.000Z',
      hubspot_owner_id: 'test-owner',
    },
  },
}

test('deal evaluation date uses the confirmed HubSpot meeting timestamp', () => {
  const properties = buildBookingDealProperties({
    ...bookingInput,
    customer: {
      firstName: 'Test',
      lastName: 'Customer',
      email: 'test@example.com',
      phone: '+1 (347) 866-5207',
      desiredTreatment: 'Compounded Semaglutide',
    },
  })

  assert.equal(
    properties.evaluation_date_and_hour_2,
    String(Date.parse(bookingInput.meeting.properties.hs_meeting_start_time)),
  )
  assert.notEqual(properties.evaluation_date_and_hour_2, String(bookingInput.option.startTime))
})

test('booking deals are marked as created by the AI bot', () => {
  const properties = buildBookingDealProperties({
    ...bookingInput,
    customer: { firstName: 'Test', lastName: 'Customer' },
  })

  assert.equal(properties.created_by_ai_bot, 'true')
})

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

  assert.equal(properties.phone, '+13478665207')
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

test('HubSpot phone values are normalized to strict E.164 format', () => {
  for (const input of [
    '19547981563',
    '9547981563',
    '+1 954-798-1563',
    '(954) 798 1563',
  ]) {
    assert.equal(formatUsPhoneForHubSpot(input), '+19547981563')
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

  assert.equal(properties.phone, '+19547981563')
})
