import test from 'node:test'
import assert from 'node:assert/strict'

import {
  GLP1_PLANS,
  GLP1_STARTING_MONTHLY_PRICE,
  buildGlp1PricingAnswer,
} from '../src/data/glp1Pricing.js'

test('general GLP-1 pricing leads with the approved monthly starting price', () => {
  assert.equal(GLP1_STARTING_MONTHLY_PRICE, 235)

  for (const [language, question] of [
    ['English', 'How much are your plans?'],
    ['Latin American Spanish', '¿Cuánto cuestan los planes?'],
    ['Portuguese', 'Quanto custam os planos?'],
  ]) {
    const answer = buildGlp1PricingAnswer(question, language)
    assert.match(answer, /\$235\/(?:month|mes|mês)/i)
    assert.match(answer, /specialist|especialista/i)
    assert.doesNotMatch(answer, /\$499|\$299/)
  }
})

test('Semaglutide questions return only the approved Semaglutide catalog', () => {
  const answer = buildGlp1PricingAnswer('What are the Semaglutide prices?', 'English')

  for (const plan of GLP1_PLANS.semaglutide) {
    assert.match(answer, new RegExp(`\\$${plan.price.toLocaleString('en-US')}`))
  }
  assert.doesNotMatch(answer, /\$470|\$599|\$897|\$1,494|\$2,820/)
})

test('Tirzepatide questions return only the approved Tirzepatide catalog', () => {
  const answer = buildGlp1PricingAnswer('Precio de Tirzepatide', 'Latin American Spanish')

  for (const plan of GLP1_PLANS.tirzepatide) {
    assert.match(answer, new RegExp(`\\$${plan.price.toLocaleString('en-US')}`))
  }
  assert.doesNotMatch(answer, /\$298|\$399|\$597|\$1,014|\$1,788/)
})

test('explicit comparisons include both product catalogs without recommending one', () => {
  const answer = buildGlp1PricingAnswer(
    'Compare all Semaglutide and Tirzepatide options',
    'English',
  )

  assert.match(answer, /Semaglutide prices:/)
  assert.match(answer, /Tirzepatide prices:/)
  assert.doesNotMatch(answer, /\b(best|better|recommend|stronger|safer)\b/i)
})
