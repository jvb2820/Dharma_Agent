import test from 'node:test'
import assert from 'node:assert/strict'

import {
  chooseConfirmedState,
  confirmsOfferedSlotTime,
  findStateNameWithMinorTypo,
  getMinimumStartAfterSlotRejection,
  getNextPreferenceAfterRejectedRelativeDay,
  hasStrictRequestedDay,
  hasCallFormatQuestion,
  isEarlierSchedulingPreference,
  isExactCasualAffirmative,
  looksLikeExplicitStateDeclaration,
  shouldAcceptStateAbbreviationToken,
  shouldTreatOkAsAffirmative,
  rejectsOfferedCalendarDate,
  resolveKansasLocationClarification,
} from '../src/utils/bookingRules.js'
import { detectLatestMessageLanguage, resolveLatestMessageLanguage } from '../src/utils/conversationLanguage.js'
import { formatCustomerStateSlot, getStateTimeZone } from './timezones.js'
import { applyDefaultAvailabilityRule } from '../src/utils/availabilityRules.js'
import { getCanonicalStateAlias } from '../src/utils/stateAliases.js'
import { CITY_STATE_OPTIONS } from '../src/data/usCityStates.js'
import {
  isGhkProductQuestion,
  isOralProductQuestion,
  isReboundEffectQuestion,
  isSupplementProductQuestion,
} from '../src/utils/leadIntentRules.js'
import { buildSupplementCatalogAnswer, isContextualSupplementQuestion } from '../src/data/supplements.js'
import { hasAffordabilityObjection, isContextualAffordabilityObjection } from '../src/utils/affordabilityRules.js'

test('named Dharma supplement questions are recognized as product questions', () => {
  for (const message of [
    'YO QUIERO SABER CÓMO SE USA LA BERBERINA Y EL FAT BURNER',
    'How do I use Berberine Plus?',
    'Tell me about MCT Fat Burner',
  ]) {
    assert.equal(isSupplementProductQuestion(message), true)
  }
})

test('supplement catalog answers prices instead of inventing a regimen', () => {
  const answer = buildSupplementCatalogAnswer('Latin American Spanish', 'Quiero saber qué suplementos tienen y cuánto cuestan para bajar 50 libras')
  assert.match(answer, /MCT Fat Burner: \$33\.90/)
  assert.match(answer, /Berberine\+ HCL 97%: \$39\.99/)
  assert.match(answer, /pueden ayudar a apoyar tu meta de pérdida de peso/i)
  assert.doesNotMatch(answer, /antes de la comida principal/i)
})

test('a price follow-up remains in supplement context', () => {
  assert.equal(isContextualSupplementQuestion('¿Y cuánto cuesta?', [{ role: 'user', content: 'Quiero información sobre sus suplementos' }]), true)
  assert.equal(isContextualSupplementQuestion('¿Y cuánto cuesta?', [{ role: 'user', content: 'Tienen Tirzepatide?' }]), false)
})

test('named supplement directions use the catalog label instructions', () => {
  const answer = buildSupplementCatalogAnswer('Latin American Spanish', '¿Cómo se toma la berberina?')
  assert.match(answer, /Berberine\+ HCL 97%/)
  assert.match(answer, /Take 2 capsules daily\./)
  assert.doesNotMatch(answer, /before the main meal/i)
  assert.doesNotMatch(answer, /MCT Fat Burner/)
})

test('English and Spanish affordability objections are recognized alongside a state', () => {
  for (const message of [
    'This is too expensive for me to pay',
    'Es Maryland pero eso es mucho para mí pagar',
    'Como le mencioné es mucho dinero',
    'No me alcanza para eso',
  ]) {
    assert.equal(hasAffordabilityObjection(message), true)
  }
})

test('a refusal after an affordability objection remains in affordability context', () => {
  const messages = [{ role: 'user', content: 'Eso es mucho dinero para mí' }]
  assert.equal(isContextualAffordabilityObjection('No puedo con eso, gracias', messages), true)
})

test('Spanish state names resolve to canonical US state names', () => {
  const cases = [
    ['Nueva York', 'New York'],
    ['nueva jersey', 'New Jersey'],
    ['Nuevo México', 'New Mexico'],
    ['Carolina del Norte', 'North Carolina'],
    ['Pensilvania', 'Pennsylvania'],
    ['en massachuse', 'Massachusetts'],
    ['Massachusets', 'Massachusetts'],
    ['Masachussetts', 'Massachusetts'],
    ['Massachussetts', 'Massachusetts'],
  ]

  for (const [input, expected] of cases) {
    assert.equal(getCanonicalStateAlias(input), expected)
  }
})

test('option replies 1, 2, and 3 are Spanish only', () => {
  for (const message of ['1', '2', '3', ' 1 ', 'option 1', 'Option 2', 'option 3']) {
    assert.equal(detectLatestMessageLanguage(message), 'Latin American Spanish')
  }

  for (const message of ['4', '12', 'option 4', '1pm', '1 pm', '1 p.m.', '1.', '#1']) {
    assert.equal(detectLatestMessageLanguage(message), '')
  }
})

test('Spanish plural option replies select the Spanish opening', () => {
  for (const message of ['Los 3', 'las 3', 'los tres', 'Las dos', 'Todas las opciones', '1,2y 3', '1, 2 y 3']) {
    assert.equal(detectLatestMessageLanguage(message), 'Latin American Spanish')
  }

  for (const message of ['3 PM', 'Route 3', 'the 3 options']) {
    assert.equal(detectLatestMessageLanguage(message), '')
  }
})

test('Spanish pricing shorthand preserves Spanish during the booking flow', () => {
  assert.equal(detectLatestMessageLanguage('589 mensual?'), 'Latin American Spanish')
})

test('latest Spanish scheduling messages override an earlier English language', () => {
  for (const message of [
    'No, puedo el sabado',
    'No, mas tarde el sabado',
    'Solo puedo el sabado',
    'en nevada',
    'quiero saber el precio',
    'yo soy hipertensa',
    'Tiene a las 12pm de california?',
  ]) {
    assert.equal(resolveLatestMessageLanguage(message, 'English'), 'Latin American Spanish')
  }
})

test('Spanish treatment requests select Spanish for the opening templates', () => {
  for (const message of [
    'Necesito la tirzepatida',
    'Tienen tirzepatida',
    'Bajar de peso',
    'Bajar de peso de forma segura',
  ]) {
    assert.equal(detectLatestMessageLanguage(message), 'Latin American Spanish')
  }
})

test('state and city names do not accidentally switch an established language', () => {
  assert.equal(detectLatestMessageLanguage('Washington'), '')
  assert.equal(detectLatestMessageLanguage('Vivo en Washington'), 'Latin American Spanish')
  assert.deepEqual(CITY_STATE_OPTIONS.minneapolis, ['Minnesota'])
  assert.deepEqual(CITY_STATE_OPTIONS.danbury, ['Connecticut'])
  assert.deepEqual(CITY_STATE_OPTIONS.manhattan, ['New York'])
})

test('unique cities resolve without requiring a state reconfirmation', () => {
  assert.deepEqual(CITY_STATE_OPTIONS.manhattan, ['New York'])
  assert.deepEqual(CITY_STATE_OPTIONS.houston, ['Texas'])
  assert.deepEqual(CITY_STATE_OPTIONS.portland, ['Oregon', 'Maine'])
})

test('city plus lowercase state abbreviation is accepted as explicit location', () => {
  assert.equal(shouldAcceptStateAbbreviationToken({
    rawToken: 'tx',
    abbreviation: 'TX',
    content: 'Houston tx',
  }), true)
  assert.equal(shouldAcceptStateAbbreviationToken({
    rawToken: 'ma',
    abbreviation: 'MA',
    content: 'Boston ma',
  }), true)
})

test('rebound-effect questions are recognized deterministically', () => {
  for (const message of ['¿Tiene efecto rebote?', 'efecto rebote', 'rebound effect', 'efeito rebote']) {
    assert.equal(isReboundEffectQuestion(message), true)
  }
})

test('pill questions are recognized while a booking field is pending', () => {
  for (const message of [
    'Pero tienen las pastillas?',
    '¿Tienen cápsulas?',
    'Do you have pills?',
    'Vocês têm comprimidos?',
  ]) {
    assert.equal(isOralProductQuestion(message), true)
  }
})

test('GHK-Cu questions are recognized while a booking field is pending', () => {
  for (const message of [
    'Por casualidad trabajan con GHK-CU?',
    '¿Trabajan con GHK Cu?',
    'Do you work with GHK-Cu?',
    'Vocês trabalham com GHK?',
  ]) {
    assert.equal(isGhkProductQuestion(message), true)
  }
})

test('the latest customer message controls English, Spanish, and Portuguese replies', () => {
  const cases = [
    { message: "I can't tomorrow", fallback: 'Portuguese', expected: 'English' },
    { message: 'Mañana no puedo', fallback: 'English', expected: 'Latin American Spanish' },
    { message: 'Amanhã não posso', fallback: 'Latin American Spanish', expected: 'Portuguese' },
  ]

  for (const { message, fallback, expected } of cases) {
    assert.equal(detectLatestMessageLanguage(message), expected)
    assert.equal(resolveLatestMessageLanguage(message, fallback), expected)
    assert.equal(getNextPreferenceAfterRejectedRelativeDay(message), 'day after tomorrow')
  }
})

test('a Spanish denial of Portuguese is classified as Spanish', () => {
  assert.equal(detectLatestMessageLanguage('No hablo portugués'), 'Latin American Spanish')
  assert.equal(detectLatestMessageLanguage('Y cual fue el tratamento que ella utilizó?'), 'Latin American Spanish')
})

test('the active confirmed state beats stale profile and historical states', () => {
  assert.equal(chooseConfirmedState({
    activeState: 'California',
    profileState: 'Massachusetts',
    historicalState: 'Massachusetts',
  }), 'California')
})

test('only an explicit latest-message state changes the active state', () => {
  assert.equal(chooseConfirmedState({ latestState: 'Nevada', activeState: 'California' }), 'Nevada')
  assert.equal(chooseConfirmedState({ activeState: 'California', profileState: 'Massachusetts' }), 'California')
})

test('Kansas location ambiguity pauses state confirmation until resolved', () => {
  assert.deepEqual(resolveKansasLocationClarification('Kansas'), {
    state: '',
    needsClarification: true,
  })
  assert.deepEqual(resolveKansasLocationClarification('Kansas City'), {
    state: '',
    needsClarification: true,
  })
  assert.equal(resolveKansasLocationClarification('Missouri', true).state, 'Missouri')
  assert.equal(resolveKansasLocationClarification('Kansas', true).state, 'Kansas')
})

test('explicit Kansas locations bypass clarification safely', () => {
  assert.equal(resolveKansasLocationClarification('Kansas City, Missouri').state, 'Missouri')
  assert.equal(resolveKansasLocationClarification('Kansas City, Kansas').state, 'Kansas')
  assert.equal(resolveKansasLocationClarification('state of Kansas').state, 'Kansas')
  assert.equal(resolveKansasLocationClarification('Colorado').needsClarification, false)
})

test('Saturday and explicit dates are hard availability constraints', () => {
  assert.equal(hasStrictRequestedDay('sábado afternoon'), true)
  assert.equal(hasStrictRequestedDay('Saturday'), true)
  assert.equal(hasStrictRequestedDay('Jul 25'), true)
  assert.equal(hasStrictRequestedDay('later'), false)
})

test('a rejected relative date rejects the whole offered calendar day', () => {
  assert.equal(rejectsOfferedCalendarDate('Mañana no puedo'), true)
  assert.equal(rejectsOfferedCalendarDate("I can't make Thursday"), true)
  assert.equal(rejectsOfferedCalendarDate('Amanhã não posso'), true)
  assert.equal(rejectsOfferedCalendarDate('11:00 no me funciona'), false)
})

test('a rejected relative day advances scheduling instead of searching it again', () => {
  for (const message of [
    'Mañana no puedo',
    "I can't tomorrow",
    'Amanhã não posso',
  ]) {
    assert.equal(getNextPreferenceAfterRejectedRelativeDay(message), 'day after tomorrow')
  }

  assert.equal(getNextPreferenceAfterRejectedRelativeDay("I can't today"), 'tomorrow')
  assert.equal(getNextPreferenceAfterRejectedRelativeDay('Tomorrow works for me'), '')
})

test('a rejected time moves the next offer at least three hours later', () => {
  const offeredStart = Date.UTC(2026, 6, 24, 16, 20)

  assert.equal(
    getMinimumStartAfterSlotRejection('No puedo esa hora', offeredStart),
    Date.UTC(2026, 6, 24, 19, 20),
  )
  assert.equal(getMinimumStartAfterSlotRejection('No puedo hoy', offeredStart), undefined)
})

test('an affirmative reply repeating the offered time confirms that slot', () => {
  assert.equal(confirmsOfferedSlotTime('Está bien a las 2', 14, 0), true)
  assert.equal(confirmsOfferedSlotTime('Yes, 2:00 pm works', 14, 0), true)
  assert.equal(confirmsOfferedSlotTime('No, a las 2 no puedo', 14, 0), false)
  assert.equal(confirmsOfferedSlotTime('Está bien a las 2:20', 14, 0), false)
  assert.equal(confirmsOfferedSlotTime('Está bien a las 2', 15, 0), false)
})

test('working at the offered time also moves the next offer three hours later', () => {
  const offeredStart = Date.UTC(2026, 6, 31, 16, 20)
  const expectedStart = Date.UTC(2026, 6, 31, 19, 20)

  for (const reply of [
    'No a esa hora estoy trabajando',
    'No, I am working at this time',
    'Nao, estou trabalhando nesse horario',
  ]) {
    assert.equal(getMinimumStartAfterSlotRejection(reply, offeredStart), expectedStart)
  }
})

test('plural weekday preferences are strict calendar constraints', () => {
  assert.equal(hasStrictRequestedDay('solo puedo los sábados'), true)
  assert.equal(hasStrictRequestedDay('Saturdays only'), true)
})

test('"antes" in a question does not request an earlier appointment', () => {
  assert.equal(isEarlierSchedulingPreference('Sí, pero antes me puedes decir si es gratis?'), false)
  assert.equal(isEarlierSchedulingPreference('Antes de confirmar, ¿me puedes explicar el precio?'), false)
  assert.equal(isEarlierSchedulingPreference('¿Tienes algo más temprano?'), true)
  assert.equal(isEarlierSchedulingPreference('Quiero una hora antes'), true)
})

test('call-format questions are not availability changes', () => {
  assert.equal(hasCallFormatQuestion('La cita es por llamada normal o videollamada?'), true)
  assert.equal(hasCallFormatQuestion('Is it a regular phone call or a video call?'), true)
  assert.equal(hasCallFormatQuestion('A consulta é por chamada normal ou videochamada?'), true)
  assert.equal(hasCallFormatQuestion('Después de las 6'), false)
})

test('Spanish "La" never overwrites the state with Louisiana', () => {
  assert.equal(shouldAcceptStateAbbreviationToken({
    rawToken: 'La',
    abbreviation: 'LA',
    content: 'La llamada es gratis',
  }), false)
  assert.equal(shouldAcceptStateAbbreviationToken({
    rawToken: 'la',
    abbreviation: 'LA',
    content: 'a la misma hora',
  }), false)
  assert.equal(shouldAcceptStateAbbreviationToken({
    rawToken: 'LA',
    abbreviation: 'LA',
    content: 'LA',
  }), true)
})

test('Spanish "de" is not treated as Delaware while uppercase DE remains valid', () => {
  assert.equal(
    shouldAcceptStateAbbreviationToken({
      rawToken: 'de',
      abbreviation: 'DE',
      content: 'Vivo en el estado de Texas en Austin',
    }),
    false,
  )
  assert.equal(
    shouldAcceptStateAbbreviationToken({
      rawToken: 'DE',
      abbreviation: 'DE',
      content: 'I live in DE',
    }),
    true,
  )
})

test('Spanish "mi" is not treated as Michigan in ordinary customer replies', () => {
  assert.equal(
    shouldAcceptStateAbbreviationToken({
      rawToken: 'mi',
      abbreviation: 'MI',
      content: 'Trabajo mañana y ese horario no me funciona pero tambien esta fuera de mi alcance economico.',
    }),
    false,
  )
  assert.equal(
    shouldAcceptStateAbbreviationToken({
      rawToken: 'MI',
      abbreviation: 'MI',
      content: 'MI',
    }),
    true,
  )
})

test('unrelated uppercase acronyms are not treated as states', () => {
  for (const [rawToken, abbreviation, content] of [
    ['ID', 'ID', 'Necesito mostrar mi ID para la consulta'],
    ['PR', 'PR', 'Trabajo en PR y marketing'],
    ['OR', 'OR', 'The OR team will call me later'],
  ]) {
    assert.equal(
      shouldAcceptStateAbbreviationToken({ rawToken, abbreviation, content }),
      false,
    )
  }
})

test('state abbreviations still work in explicit location and shipping replies', () => {
  for (const [rawToken, abbreviation, content] of [
    ['TX', 'TX', 'TX'],
    ['tx', 'TX', 'Houston tx'],
    ['DE', 'DE', 'I live in DE'],
    ['PR', 'PR', 'Do you ship to PR?'],
  ]) {
    assert.equal(
      shouldAcceptStateAbbreviationToken({ rawToken, abbreviation, content }),
      true,
    )
  }
})

test('exact Spanish casual reply "sip" confirms an inferred state', () => {
  assert.equal(isExactCasualAffirmative('Sip'), true)
  assert.equal(isExactCasualAffirmative('sip!'), true)
  assert.equal(isExactCasualAffirmative('SIP protocol'), false)
})

test('exact "ok" accepts an active slot without changing the confirmed state to Oklahoma', () => {
  for (const content of ['ok', 'Ok', 'OK', 'ok!']) {
    assert.equal(
      shouldTreatOkAsAffirmative({
        content,
        activeState: 'Maryland',
        hasActiveSlot: true,
      }),
      true,
    )
  }

  assert.equal(
    chooseConfirmedState({
      latestState: '',
      activeState: 'Maryland',
      historicalState: 'Oklahoma',
    }),
    'Maryland',
  )
})

test('lowercase "ok" at the end of a sentence does not change the state to Oklahoma', () => {
  assert.equal(
    shouldAcceptStateAbbreviationToken({
      rawToken: 'ok',
      abbreviation: 'OK',
      content: 'Necesito hablar primero con mis hijos, ellos son los que me van a dar el dinero y les aviso ok.',
    }),
    false,
  )
})

test('a bare "ok" reply to the pending state question is interpreted as Oklahoma', () => {
  for (const rawToken of ['ok', 'Ok', 'OK']) {
    assert.equal(
      shouldAcceptStateAbbreviationToken({
        rawToken,
        abbreviation: 'OK',
        content: rawToken,
      }),
      true,
    )
  }

  assert.equal(
    shouldTreatOkAsAffirmative({
      content: 'ok',
      activeState: '',
      hasActiveSlot: false,
    }),
    false,
  )
})

test('a bare "ok" after state collection is treated as an acknowledgement', () => {
  assert.equal(
    shouldTreatOkAsAffirmative({
      content: 'ok',
      activeState: 'California',
      hasActiveSlot: false,
    }),
    true,
  )

  assert.equal(
    shouldAcceptStateAbbreviationToken({
      rawToken: 'OK',
      abbreviation: 'OK',
      content: 'Tulsa, OK',
    }),
    true,
  )
})

test('"ok" remains available as Oklahoma when no state or slot context exists', () => {
  assert.equal(shouldTreatOkAsAffirmative({ content: 'OK' }), false)
  assert.equal(
    shouldTreatOkAsAffirmative({
      content: 'Actually, Oklahoma',
      activeState: 'Maryland',
      hasActiveSlot: true,
    }),
    false,
  )
})

test('one-letter state typos are recovered only in explicit location replies', () => {
  const states = ['Connecticut', 'Florida', 'California', 'South Carolina']

  assert.equal(findStateNameWithMinorTypo('I live in florid', states), 'Florida')
  assert.equal(findStateNameWithMinorTypo('Vivo en Florid', states), 'Florida')
  assert.equal(findStateNameWithMinorTypo('Californa', states), 'California')
  assert.equal(findStateNameWithMinorTypo('I live in folrida', states), 'Florida')
  assert.equal(findStateNameWithMinorTypo('Vivo en connectciut', states), 'Connecticut')
  assert.equal(findStateNameWithMinorTypo('Tell me about florid treatment prices', states), '')
})

test('only explicit location wording can trigger unresolved-state clarification', () => {
  assert.equal(looksLikeExplicitStateDeclaration('I live in Florid'), true)
  assert.equal(looksLikeExplicitStateDeclaration('Vivo en Folrida'), true)
  assert.equal(looksLikeExplicitStateDeclaration('I am in pain'), false)
  assert.equal(looksLikeExplicitStateDeclaration('Can you answer my question?'), false)
})

test('California slots are formatted in California local time', () => {
  assert.equal(getStateTimeZone('California'), 'America/Los_Angeles')
  assert.match(formatCustomerStateSlot(Date.UTC(2026, 6, 25, 19, 0), 'California'), /12:00 PM California Time/)
})

test('customer-facing slots localize the complete date and timezone label', () => {
  const timestamp = Date.UTC(2026, 6, 23, 16, 0)
  const english = formatCustomerStateSlot(timestamp, 'Missouri', 'America/Chicago', 'English')
  const spanish = formatCustomerStateSlot(timestamp, 'Missouri', 'America/Chicago', 'Latin American Spanish')
  const portuguese = formatCustomerStateSlot(timestamp, 'Missouri', 'America/Chicago', 'Portuguese')

  assert.match(english, /Thursday/i)
  assert.match(english, /Missouri Time/)
  assert.match(spanish, /jueves/i)
  assert.match(spanish, /Hora de Missouri/)
  assert.doesNotMatch(spanish, /Thursday|Missouri Time/)
  assert.match(portuguese, /quinta-feira/i)
  assert.match(portuguese, /Horário de Missouri/)
})

test('availability defaults to 9 AM but explicit early requests override it', () => {
  assert.equal(applyDefaultAvailabilityRule({}, '').earliestHour, 9)
  assert.equal(applyDefaultAvailabilityRule({}, '7:00 AM').earliestHour, 7)
  assert.equal(applyDefaultAvailabilityRule({}, '12:00 PM').earliestHour, 12)
})

test('an earlier request removes the default 9 AM lower bound', () => {
  const result = applyDefaultAvailabilityRule({
    earliestHour: 9,
    direction: 'earlier',
    allowBeforeDefaultStart: true,
    latestStartTime: Date.UTC(2026, 6, 23, 16, 20),
  })
  assert.equal(result.earliestHour, undefined)
  assert.equal(result.latestStartTime, Date.UTC(2026, 6, 23, 16, 20))
})
