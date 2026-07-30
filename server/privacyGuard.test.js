import test from 'node:test'
import assert from 'node:assert/strict'

import {
  hasExplicitNamedPersonMedicationQuestion,
  isExplicitThirdPartyMedicationQuestion,
  isGeneralMedicationSafetyQuestion,
} from './privacyGuard.js'
import {
  hasNamedPersonTreatmentQuestion,
  isTreatmentAcquisitionQuestion,
} from '../src/utils/privacyRules.js'

test('Spanish treatment acquisition questions never trigger client privacy', () => {
  for (const message of [
    'Como las consigo',
    '¿Cómo puedo obtenerlas?',
    'Donde las compro',
  ]) {
    assert.equal(isTreatmentAcquisitionQuestion(message), true)
    assert.equal(hasNamedPersonTreatmentQuestion(message), false)
    assert.equal(hasExplicitNamedPersonMedicationQuestion(message), false)
  }
})

test('an explicit comparison with another person remains a privacy question', () => {
  assert.equal(
    hasNamedPersonTreatmentQuestion('Quiero el mismo tratamiento que ella'),
    true,
  )
})

test('recognizes named-person medication questions regardless of capitalization', () => {
  for (const message of [
    'I wanna know which medication did Diana torres have',
    'Which medication did dayanara torres use?',
    'How about which treatment diana torres had?',
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

test('third-party customer treatment questions are privacy questions', () => {
  for (const message of [
    'Which treatment did your customer take?',
    'What medication is the client using?',
    'Which injections did that patient receive?',
    'Que tratamiento uso su cliente?',
    'Qual medicamento sua cliente usou?',
  ]) {
    assert.equal(isExplicitThirdPartyMedicationQuestion(message), true)
  }
})

test('general treatment questions are not privacy questions', () => {
  for (const message of [
    'Which treatments?',
    'Which medications?',
    'What treatments do you offer?',
    'Is it safe to take?',
    'May I know more about your treatments?',
  ]) {
    assert.equal(isExplicitThirdPartyMedicationQuestion(message), false)
    assert.equal(hasExplicitNamedPersonMedicationQuestion(message), false)
  }
})

test('a Tirzepatide price question is general pricing, not client privacy', () => {
  assert.equal(
    hasExplicitNamedPersonMedicationQuestion('Quiero saber el precio de la Tirzepatide'),
    false,
  )
})

test('does not treat general medication questions as named-person questions', () => {
  for (const message of [
    'I wanna know more about the medications first',
    'Before that May I know more about your medications?',
    'No quiero saber de una persona, quiero saber lo que ofrecen',
    'Quiero saber cual es el medicamento',
  ]) {
    assert.equal(hasExplicitNamedPersonMedicationQuestion(message), false)
  }
})
