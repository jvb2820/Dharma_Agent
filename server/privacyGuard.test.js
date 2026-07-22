import test from 'node:test'
import assert from 'node:assert/strict'

import {
  hasExplicitNamedPersonMedicationQuestion,
  isGeneralMedicationSafetyQuestion,
} from './privacyGuard.js'

test('recognizes named-person medication questions regardless of capitalization', () => {
  for (const message of [
    'I wanna know which medication did Diana torres have',
    'Which medication did dayanara torres use?',
    'Que medicamento uso Dayanara Torres?',
    'Es el mismo tratamento que Dayanara Torres utilizó?',
    'No, i want to know if ill use the same things as maria cristina',
    'Will I use the same treatment as Maria Cristina?',
  ]) {
    assert.equal(hasExplicitNamedPersonMedicationQuestion(message), true)
  }
})

test('general medication safety questions never route to client privacy', () => {
  for (const message of [
    'Is it safe to take the treatment?',
    'Is the medication safe and effective?',
    'Es seguro tomar el tratamiento?',
    'É seguro tomar o medicamento?',
  ]) {
    assert.equal(isGeneralMedicationSafetyQuestion(message), true)
    assert.equal(hasExplicitNamedPersonMedicationQuestion(message), false)
  }
})

test('named-person safety questions remain privacy questions', () => {
  assert.equal(isGeneralMedicationSafetyQuestion('Was the treatment safe for Maria Lopez?'), false)
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
