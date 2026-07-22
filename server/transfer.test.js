import test from 'node:test'
import assert from 'node:assert/strict'

import {
  detectRespondTransferTrigger,
  isDoctorOrProviderQuestion,
  isGeneralProductOrMedicationClarification,
} from './transfer.js'

test('does not transfer Spanish questions about speaking with a doctor', () => {
  const message = 'No, voy hablar con un doctor?'

  assert.equal(isDoctorOrProviderQuestion(message), true)
  assert.equal(detectRespondTransferTrigger(message), null)
})

test('does not transfer equivalent provider questions in supported languages', () => {
  for (const message of [
    'Voy a hablar con un medico?',
    'Will I speak with a licensed provider?',
    'Vou falar com um doutor?',
  ]) {
    assert.equal(detectRespondTransferTrigger(message), null)
  }
})

test('still transfers explicit Customer Service requests', () => {
  assert.deepEqual(detectRespondTransferTrigger('Quiero hablar con servicio al cliente'), {
    type: 'transfer_request',
    reason: 'Customer requested a human transfer or escalation.',
  })
})

test('still transfers irate complaints', () => {
  assert.equal(detectRespondTransferTrigger('Esto es una estafa, quiero mi reembolso')?.type, 'irate_customer')
})

test('does not transfer general medication questions or product clarifications', () => {
  for (const message of [
    'No, wuiero saber cual es el medicamento',
    'Pero no quiero saber de una persona, quiero saber lo que ofrecen',
    'Pero no wuiero saber de una persona quiero saber lo qhw oferezen',
    'I want to know which medication you offer',
  ]) {
    assert.equal(isGeneralProductOrMedicationClarification(message), true)
    assert.equal(detectRespondTransferTrigger(message), null)
  }
})

test('recognizes polite general questions about our medications', () => {
  assert.equal(
    isGeneralProductOrMedicationClarification('Before that May I know more about your medications?'),
    true,
  )
})
