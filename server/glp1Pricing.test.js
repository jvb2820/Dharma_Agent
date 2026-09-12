import test from 'node:test'
import assert from 'node:assert/strict'

import {
  GLP1_PLAN_PRICE,
  buildGlp1PricingAnswer,
} from '../src/data/glp1Pricing.js'

test('all treatment pricing questions mention only the $589-range plan', () => {
  assert.equal(GLP1_PLAN_PRICE, 589)

  for (const [language, question] of [
    ['English', 'How much are your plans?'],
    ['Latin American Spanish', '¿Qué precio tienen las inyecciones de semaglutide?'],
    ['Portuguese', 'Compare todos os preços de Semaglutida e Tirzepatida'],
  ]) {
    const answer = buildGlp1PricingAnswer(question, language)
    const prices = answer.match(/\$[\d,]+/g) || []

    assert.deepEqual(prices, ['$589'])
    assert.match(answer, /specialist|especialista/i)
    assert.match(answer, /free|gratuita/i)
  }
})

test('product-specific and comparison questions do not expose a price catalog', () => {
  for (const question of [
    'What are the Semaglutide prices?',
    'What does Tirzepatide cost?',
    'Compare all Semaglutide and Tirzepatide options',
  ]) {
    const answer = buildGlp1PricingAnswer(question, 'English')

    assert.match(answer, /\$589/)
    assert.doesNotMatch(answer, /\$235|\$298|\$399|\$470|\$597|\$599|\$897|\$1,014|\$1,494|\$1,788|\$2,820/)
  }
})
