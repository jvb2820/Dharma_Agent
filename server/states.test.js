import test from 'node:test'
import assert from 'node:assert/strict'

import {
  NON_SERVICEABLE_STATES,
  SERVICEABLE_STATES,
  US_STATES,
  isPrescribedTreatmentDeliveryState,
} from '../src/data/states.js'

test('prescribed-treatment shipping is blocked only in the configured ten jurisdictions', () => {
  assert.deepEqual(NON_SERVICEABLE_STATES, [
    'Alabama',
    'Alaska',
    'Arkansas',
    'District of Columbia',
    'Idaho',
    'Kansas',
    'Kentucky',
    'Louisiana',
    'Mississippi',
    'West Virginia',
  ])

  for (const state of NON_SERVICEABLE_STATES) {
    assert.equal(isPrescribedTreatmentDeliveryState(state), false, state)
  }

  for (const state of US_STATES.filter((state) => !NON_SERVICEABLE_STATES.includes(state))) {
    assert.equal(isPrescribedTreatmentDeliveryState(state), true, state)
  }

  assert.equal(SERVICEABLE_STATES.includes('Puerto Rico'), true)
  assert.equal(isPrescribedTreatmentDeliveryState('Canada'), false)
})
