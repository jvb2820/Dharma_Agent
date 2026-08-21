import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildRespondTransferMessage,
  detectRespondTransferTrigger,
  isDoctorOrProviderQuestion,
  isGeneralProductOrMedicationClarification,
  isRespondImageMessage,
} from './transfer.js'

test('state clarification handoffs use neutral Front Desk wording', () => {
  for (const [language, expected] of [
    ['English', /Front Desk team.*confirm your location/i],
    ['Latin American Spanish', /Front Desk.*confirmarán tu ubicación/i],
    ['Portuguese', /Front Desk.*confirmarão sua localização/i],
  ]) {
    const message = buildRespondTransferMessage({
      customerLanguage: language,
      trigger: { type: 'state_location_clarification' },
    })

    assert.match(message, expected)
    assert.doesNotMatch(message, /frustrat|complaint|queja/i)
  }
})

test('image handoffs use neutral Front Desk wording', () => {
  for (const [language, expected] of [
    ['English', /received your image.*Front Desk/i],
    ['Latin American Spanish', /Recibimos tu imagen.*Front Desk/i],
    ['Portuguese', /Recebemos sua imagem.*Front Desk/i],
  ]) {
    const message = buildRespondTransferMessage({
      customerLanguage: language,
      trigger: { type: 'unsupported_image_message' },
    })

    assert.match(message, expected)
    assert.doesNotMatch(message, /frustrat|complaint|queja/i)
  }
})

test('recognizes common Respond image attachment shapes', () => {
  for (const message of [
    { type: 'image' },
    { messageType: 'photo' },
    { attachment: { type: 'image' } },
    { attachments: [{ mimeType: 'image/jpeg' }] },
    { mime_type: 'image/png' },
    { image: { url: 'https://example.com/image.webp' } },
  ]) {
    assert.equal(isRespondImageMessage(message), true)
  }

  assert.equal(isRespondImageMessage({ attachment: { type: 'video' } }), false)
  assert.equal(isRespondImageMessage({ mimeType: 'audio/ogg' }), false)
})

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

test('transfers Spanish scam accusations across conjugations and common typos', () => {
  for (const message of [
    'Ustedes me estafaron porque yo no baje peso',
    'O no quieren saber la verdad que lo wstafan a uno',
    'Me engañaron con este tratamiento',
    'Son unos ladrones',
  ]) {
    assert.equal(detectRespondTransferTrigger(message)?.type, 'irate_customer')
  }
})

test('transfers serious treatment and payment complaints without requiring the word scam', () => {
  for (const message of [
    'Pague mas de $3000 con ustedes y no vi resultados',
    'Gaste mucho dinero y no baje de peso',
    'Me cobraron $3000 y no obtuve resultados',
    'Me dieron mas B12 que GLP1',
  ]) {
    assert.equal(detectRespondTransferTrigger(message)?.type, 'irate_customer')
  }
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
