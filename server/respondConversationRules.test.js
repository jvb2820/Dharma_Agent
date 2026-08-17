import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyBookingFailure,
  isGeneratedBookingPromptLine,
  isGeneralZepboundQuestion,
  isInitialConsultationCostQuestion,
  isInsuranceQuestion,
} from './respondConversationRules.js'

test('recognizes a model-generated Spanish reservation question for removal', () => {
  assert.equal(isGeneratedBookingPromptLine(
    '¿Quieres reservar la llamada para el lunes 17 de agosto a las 5:00 p.m., horario de California?',
  ), true)
  assert.equal(isGeneratedBookingPromptLine('Estamos ubicados en Boca Raton, Florida.'), false)
})
import { splitCustomerFullName } from './newClientFlow.js'

test('a general Zepbound question is never treated as a named-person question', () => {
  assert.equal(isGeneralZepboundQuestion('¿Qué es el Zepbound?'), true)
  assert.equal(isGeneralZepboundQuestion('What is Zepbound?'), true)
  assert.equal(isGeneralZepboundQuestion('Did Maria Lopez use Zepbound?'), false)
})

test('recognizes common Spanish insurance misspellings', () => {
  for (const message of ['Aceptan seguro?', 'Afectan seguro', 'Asectan seguro', 'Aseptan seguro médico?']) {
    assert.equal(isInsuranceQuestion(message), true)
  }
})

test('recognizes the active discovery-call cost question', () => {
  assert.equal(isInitialConsultationCostQuestion('¿Cuánto cuesta la consulta?'), true)
  assert.equal(isInitialConsultationCostQuestion('Do you charge for the consultation?'), true)
})

test('classifies booking errors without treating every failure as a lost slot', () => {
  assert.equal(classifyBookingFailure({ status: 429, message: 'Too many requests' }), 'temporary')
  assert.equal(classifyBookingFailure(new Error('This slot is no longer available')), 'slot_unavailable')
  assert.equal(classifyBookingFailure(new Error('Unexpected HubSpot response')), 'unknown')
})

test('extracts a name from a message that also changes the requested time', () => {
  assert.deepEqual(splitCustomerFullName('8.30am mi nombre es Jenny'), {
    firstName: 'Jenny',
    lastName: '',
    nameConfirmed: true,
  })
})
