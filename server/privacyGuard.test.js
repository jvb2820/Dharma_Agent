import test from 'node:test'
import assert from 'node:assert/strict'

import { hasExplicitNamedPersonMedicationQuestion } from './privacyGuard.js'

test('recognizes named-person medication questions regardless of capitalization', () => {
  for (const message of [
    'I wanna know which medication did Diana torres have',
    'Which medication did dayanara torres use?',
    'Que medicamento uso Dayanara Torres?',
  ]) {
    assert.equal(hasExplicitNamedPersonMedicationQuestion(message), true)
  }
})

test('does not treat general medication questions as named-person questions', () => {
  for (const message of [
    'I wanna know more about the medications first',
    'No quiero saber de una persona, quiero saber lo que ofrecen',
    'Quiero saber cual es el medicamento',
  ]) {
    assert.equal(hasExplicitNamedPersonMedicationQuestion(message), false)
  }
})
