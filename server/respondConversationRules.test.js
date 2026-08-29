import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyBookingFailure,
  hasKnownRespondBookingPhone,
  isGeneratedBookingPromptLine,
  isGeneralZepboundQuestion,
  isInitialConsultationCostQuestion,
  isInsuranceQuestion,
  resolveRespondContactStatus,
} from './respondConversationRules.js'

test('recognizes a model-generated Spanish reservation question for removal', () => {
  assert.equal(isGeneratedBookingPromptLine(
    '¿Quieres reservar la llamada para el lunes 17 de agosto a las 5:00 p.m., horario de California?',
  ), true)
  assert.equal(isGeneratedBookingPromptLine('Estamos ubicados en Boca Raton, Florida.'), false)
})

test('blocks generated Spanish copy that restarts detail collection without an active slot', () => {
  for (const message of [
    'Perfecto, entonces agendamos tu llamada gratuita de análisis para el miércoles 26 de agosto a las 4:20 p.m. hora de Florida. Para completar la cita, ¿me podrías confirmar tu nombre completo?',
    'Para terminar de agendar la cita, comparte tu número de teléfono.',
    'Confirmamos la cita y ahora necesito tu nombre.',
  ]) {
    assert.equal(isGeneratedBookingPromptLine(message), true)
  }

  assert.equal(
    isGeneratedBookingPromptLine('No encontré disponibilidad para ese horario. ¿Qué otro día prefieres?'),
    false,
  )
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
  assert.equal(classifyBookingFailure({ status: 429, message: 'Too many requests' }), 'hubspot_temporary')
  assert.equal(classifyBookingFailure(new Error('This slot is no longer available')), 'slot_unavailable')
  assert.equal(classifyBookingFailure(new Error('Unexpected HubSpot response')), 'hubspot_submission_rejected')
  assert.equal(
    classifyBookingFailure(new Error('HubSpot did not return a calendar event ID, so the appointment was not confirmed.')),
    'hubspot_confirmation_timeout',
  )
})

test('uses Respond lead_status as the canonical contact status fallback', () => {
  assert.equal(resolveRespondContactStatus({ lead_status: 'Client' }), 'Client')
  assert.equal(
    resolveRespondContactStatus({ contact_status: 'Evaluation Scheduled', lead_status: 'Client' }),
    'Evaluation Scheduled',
  )
  assert.equal(resolveRespondContactStatus({}, { status: 'closed' }), '')
})

test('known profile or active-booking phones prevent redundant collection', () => {
  assert.equal(hasKnownRespondBookingPhone({ profilePhone: '14243032151' }), true)
  assert.equal(hasKnownRespondBookingPhone({ bookingPhone: '17135948815' }), true)
  assert.equal(hasKnownRespondBookingPhone({ conversationPhone: '17135948815' }), true)
  assert.equal(hasKnownRespondBookingPhone({}), false)
})

test('extracts a name from a message that also changes the requested time', () => {
  assert.deepEqual(splitCustomerFullName('8.30am mi nombre es Jenny'), {
    firstName: 'Jenny',
    lastName: '',
    nameConfirmed: true,
  })
})
