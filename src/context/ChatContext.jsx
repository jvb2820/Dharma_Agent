import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAgent } from '../hooks/useAgent'
import { hubspotService } from '../services/hubspotService'
import { openaiService } from '../services/openaiService'
import { respondService } from '../services/respondService'
import { NON_SERVICEABLE_LOCATIONS, US_STATES, isPrescribedTreatmentDeliveryState } from '../data/states'
import { ChatContext } from './chat-context'

const BOOKING_FIELDS = [
  {
    key: 'desiredTreatment',
    question:
      'Got it. What are you mainly hoping to work on right now? You can say it naturally, like losing weight, Zepbound, supplements, or nutrition guidance.',
  },
  {
    key: 'state',
    question: 'Perfect. What state are you in so I can make sure we can support you there?',
  },
  {
    key: 'preferredTime',
    question: 'What day or time would feel easiest for your free consultation?',
  },
  {
    key: 'name',
    question: 'I can help with that. What name should I put on the consultation?',
  },
  {
    key: 'phone',
    question: 'Thanks. What phone number is best for the consultation?',
  },
  {
    key: 'preferredLanguage',
    question: 'What language would you prefer for the consultation: English, Spanish, or Portuguese?',
  },
]

const DEFAULT_DESIRED_TREATMENT = 'Weight Loss Injections'
const AVAILABILITY_FIELD_KEYS = ['state']
const FINAL_BOOKING_FIELD_KEYS = ['name', 'phone', 'preferredLanguage']

const INITIAL_BOOKING = {
  active: false,
  currentFieldIndex: 0,
  details: {},
  options: [],
  selectedOption: null,
  hubspotContact: null,
}

const LANGUAGE_QUESTION =
  '🌐 Hi, this is Maria from Dharma Clinic. What language do you prefer: English or Spanish?'
const INITIAL_GREETING_BY_LANGUAGE = {
  English: `Hi, my name is Maria from Dharma Clinic.

👋 It is a pleasure to have you here. You can also take a look at our Instagram *@dharma.clinic* 📸.

📍 We are a telemedicine company located in the U.S. and our consultations are online.

💰 *BEST-SELLING PRICES:*
- *$589* - Up to 4-week personalized GLP-1 package
- *$299* - Zepbound prescription access

We also offer longer treatments depending on your goal.

📲 First, we do a *free* discovery call by video.

💥 *SPECIAL OFFER TODAY* 💥`,
  'Latin American Spanish': `Hola, mi nombre es Maria, de la clinica Dharma.

👋 Es un placer tenerte aqui. Puedes echar un vistazo a nuestro Instagram *@dharma.clinic* 📸.

📍 Somos una empresa de telemedicina ubicada en EE. UU. y las consultas son online.

💰 *PRECIOS DE LOS MAS VENDIDOS:*
- *$589* - Paquete de hasta 4 semanas de GLP-1 personalizado
- *$299* - Acceso a prescripcion de Zepbound

Tenemos tratamientos mas largos para que puedas alcanzar tu objetivo.

📲 Primero realizamos una llamada de analisis *gratuita* por videollamada.

💥 *OFERTA ESPECIAL HOY* 💥`,
}
const INITIAL_STATE_QUESTION_BY_LANGUAGE = {
  English: '📍 What state do you live in so I can confirm whether we deliver there?',
  'Latin American Spanish':
    '📍 Dime por favor en que estado vives para saber si hacemos envios a tu estado.',
}

function createMessage(role, content) {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
  }
}

function detectCustomerSessionLanguage(content) {
  const normalized = String(content || '').toLowerCase()

  if (!normalized.trim()) {
    return ''
  }

  const spanishSignals = [
    '¿',
    '¡',
    'hola',
    'gracias',
    'quiero',
    'cita',
    'agendar',
    'español',
    'espanol',
    'perder peso',
    'buenas',
    'estado',
    'llamada',
  ]
  const englishSignals = [
    'hello',
    'hi',
    'thanks',
    'thank you',
    'appointment',
    'schedule',
    'english',
    'weight loss',
    'what state',
    'i want',
    'yes',
  ]

  if (/\b(s[ií]|claro|vale)\b/i.test(normalized)) {
    return 'Latin American Spanish'
  }

  if (spanishSignals.some((signal) => normalized.includes(signal))) {
    return 'Latin American Spanish'
  }

  if (englishSignals.some((signal) => normalized.includes(signal))) {
    return 'English'
  }

  if (/[a-z]/i.test(normalized) && !/[áéíóúñ¿¡]/i.test(normalized)) {
    return 'English'
  }

  return ''
}

function isSpanishSession(language) {
  return String(language || '').toLowerCase().includes('spanish')
}

function getInitialGreeting(language) {
  return INITIAL_GREETING_BY_LANGUAGE[isSpanishSession(language) ? 'Latin American Spanish' : 'English']
}

function getInitialStateQuestion(language) {
  return INITIAL_STATE_QUESTION_BY_LANGUAGE[
    isSpanishSession(language) ? 'Latin American Spanish' : 'English'
  ]
}

function bookingText(language, key, values = {}) {
  const spanish = isSpanishSession(language)
  const text = {
    name: spanish
      ? 'Claro, te ayudo con eso. Que nombre pongo para la consulta?'
      : 'I can help with that. What name should I put on the consultation?',
    phone: spanish
      ? 'Gracias. Cual es el mejor numero de telefono para la consulta?'
      : 'Thanks. What phone number is best for the consultation?',
    preferredLanguage: spanish
      ? 'En que idioma prefieres la consulta: ingles o espanol?'
      : 'What language would you prefer for the consultation: English or Spanish?',
    preferredLanguageWithName: spanish
      ? `Mucho gusto, ${values.firstName}. En que idioma te sentirias mas comodo para la consulta: ingles o espanol?`
      : `Nice to meet you, ${values.firstName}. What language would you feel most comfortable using for the consultation: English or Spanish?`,
    desiredTreatment: spanish
      ? 'Entendido. Voy a usar bajar de peso como tu objetivo y revisar disponibilidad para tu consulta gratuita.'
      : 'Got it. I will use weight loss as your goal and check availability for your free consultation.',
    state: spanish
      ? 'Dime por favor en que estado vives para saber si hacemos envios a tu estado.'
      : 'What state do you live in so I can confirm whether we deliver there?',
    preferredTime: spanish
      ? 'Voy a revisar los proximos horarios disponibles para tu consulta gratuita.'
      : 'I will check the next available times for your free consultation.',
    preferredTimeForTreatment: spanish
      ? `Tiene sentido. Para ${values.desiredTreatment}, voy a revisar los proximos horarios disponibles para tu consulta gratuita.`
      : `That makes sense. For ${values.desiredTreatment}, I will check the next available times for your free consultation.`,
    clarifyDesiredTreatment: spanish
      ? `Te entiendo. Voy a usar bajar de peso como tu objetivo y revisar disponibilidad para tu consulta gratuita.`
      : `I hear you. I will use weight loss as your goal and check availability for your free consultation.`,
    availabilityFallback: spanish
      ? 'Claro. Si esos horarios no te funcionan, reviso otra opcion disponible. Tambien puedo resolver cualquier pregunta antes de buscar otro espacio.'
      : 'Of course. If those times do not work, I can check another available option. I can also answer any questions before looking for another slot.',
    booked: spanish ? `Tu cita quedo agendada para ${values.display}.` : `You are booked for ${values.display}.`,
    noAvailability: spanish
      ? 'No veo una disponibilidad que coincida ahora mismo. Puedo revisar otro horario, otro especialista o pasarlo al equipo para ayudarte a agendar manualmente.'
      : 'I am not seeing a matching opening right now. I can check another slot, another specialist, or route this to the team for manual scheduling.',
    availabilityIntro: spanish
      ? 'Revise el calendario de nuestros especialistas y encontre estos primeros horarios disponibles:'
      : 'I checked our specialists calendars and found these earliest available times:',
    availabilityChoice: spanish
      ? 'Cual te funciona mejor? Puedes responder con el numero.'
      : 'Which one works best? You can reply with the number.',
    changeAvailability: spanish
      ? `Por supuesto, voy a revisar opciones para ${values.changes}.`
      : `Absolutely, I will check options for ${values.changes}.`,
  }

  return text[key] || ''
}

function shouldUseOutOfStatePrescribedSnippet(details) {
  return Boolean(
    details.state &&
      !isPrescribedTreatmentDeliveryState(details.state) &&
      !isAlternativeTreatment(details.desiredTreatment),
  )
}

function isAlternativeTreatment(treatment) {
  return /\b(nutrition|supplements?)\b/i.test(String(treatment || ''))
}

function outOfStatePrescribedText(language) {
  if (!isSpanishSession(language)) {
    return [
      '💛✨ At the moment, we cannot ship prescribed weight-loss injections to your state 😔.',
      'But we can still support you with our Dharma supplement line, designed to help your process naturally:',
      '🔥 *Fat Burner*: supports metabolism, clean energy, and daytime fat-burning support.',
      '🟠 *Berberine*: helps with cravings, blood sugar support, and abdominal inflammation support.',
      '💪 *Creatine*: supports strength, faster toning, and workout recovery so you can feel more fit.',
      '*You can see everything here* 👉 https://dharmanutritionclinic.com/collections/supplements',
      '',
      'We can also help with a nutrition consultation if you would like guidance without prescribed treatment.',
    ].join('\n')
  }

  return [
    '💛✨ Por el momento no podemos enviar inyecciones de pérdida de peso a su estado😔.',
    'Pero sí podemos ayudarte con nuestra línea de suplementos Dharma, diseñados para apoyar tu proceso de forma natural:',
    '🔥 *Fat Burner*: acelera el metabolismo, da energía limpia y ayuda a quemar grasa durante el día.',
    '🟠 *Berberine*: controla antojos, reduce azúcar en sangre y baja la inflamación abdominal.',
    '💪 *Creatine*: mejora fuerza, tonifica más rápido y acelera la recuperación para verte más fit.',
    '*Puedes ver todo aquí* 👉 https://dharmanutritionclinic.com/collections/supplements',
  ].join('\n')
}

async function handleBookingMessage(content, booking, memory, messages, customerLanguage) {
  const latestAgentMessage = [...messages].reverse().find((message) => message.role === 'agent')?.content || ''
  const conversationMemory = mergeBookingDetails(memory, extractBookingMemoryFromMessages(messages))
  const shouldStartBooking =
    isBookingIntent(content) ||
    (isSchedulingPrompt(latestAgentMessage) && Boolean(extractPreferredTime(content)))

  if (!booking.active && !shouldStartBooking) {
    return null
  }

  if (!booking.active) {
    let details = mergeBookingDetails(conversationMemory, extractBookingMemory(content))
    let hubspotContact = null

    if (details.email || details.phone) {
      details = withBookingEmail(details)
      const lookup = await enrichDetailsFromHubSpot(details)
      details = lookup.details
      hubspotContact = lookup.contact
    }

    details = withDefaultDesiredTreatment(details)

    const nextMissingFieldIndex = findMissingBookingFieldIndex(details, AVAILABILITY_FIELD_KEYS)

    if (shouldUseOutOfStatePrescribedSnippet(details)) {
      return {
        nextBooking: {
          ...INITIAL_BOOKING,
          active: true,
          details,
          hubspotContact,
          outOfStateNotified: true,
        },
        message: outOfStatePrescribedText(customerLanguage),
      }
    }

    if (nextMissingFieldIndex === -1) {
      return await prepareAvailabilityResponse({
        booking: { ...INITIAL_BOOKING, active: true, details, hubspotContact },
        details,
        customerLanguage,
      })
    }

    return {
      nextBooking: {
        ...INITIAL_BOOKING,
        active: true,
        details,
        hubspotContact,
        currentFieldIndex: nextMissingFieldIndex,
      },
      message: getBookingQuestion(nextMissingFieldIndex, details, customerLanguage),
    }
  }

  if (booking.options.length > 0) {
    const selectedOption = pickAvailabilityOption(content, booking.options)
    const requestedChange = extractAvailabilityChangeRequest(content)

    if (!selectedOption) {
      if (requestedChange.hasChange) {
        const nextDetails = {
          ...booking.details,
          ...requestedChange.details,
        }

        return await prepareAvailabilityResponse({
          booking: {
            ...booking,
            options: [],
          },
          details: nextDetails,
          intro: bookingText(customerLanguage, 'changeAvailability', {
            changes: requestedChange.changes.join(isSpanishSession(customerLanguage) ? ' el ' : ' on '),
          }),
          customerLanguage,
        })
      }

      return {
        nextBooking: booking,
        message: bookingText(customerLanguage, 'availabilityFallback'),
      }
    }

    const finalMissingFieldIndex = findMissingBookingFieldIndex(booking.details, FINAL_BOOKING_FIELD_KEYS)

    if (finalMissingFieldIndex !== -1) {
      return {
        nextBooking: {
          ...booking,
          selectedOption,
          currentFieldIndex: finalMissingFieldIndex,
        },
        message: getBookingQuestion(finalMissingFieldIndex, booking.details, customerLanguage),
      }
    }

    const booked = await hubspotService.bookMeeting({
      customer: normalizeBookingDetails(withBookingEmail(booking.details)),
      option: selectedOption,
    })

    return {
      nextBooking: INITIAL_BOOKING,
      message: bookingText(customerLanguage, 'booked', { display: booked.display }),
    }
  }

  const field = BOOKING_FIELDS[booking.currentFieldIndex]
  const rememberedDetails = mergeBookingDetails(conversationMemory, booking.details)
  const currentMessageDetails = extractBookingMemory(content)
  let nextDetails = collectBookingField(
    mergeBookingDetails(rememberedDetails, currentMessageDetails),
    field.key,
    content,
  )
  nextDetails = withDefaultDesiredTreatment(nextDetails)

  if (shouldUseOutOfStatePrescribedSnippet(nextDetails)) {
    return {
      nextBooking: {
        ...booking,
        details: nextDetails,
        outOfStateNotified: true,
      },
      message: outOfStatePrescribedText(customerLanguage),
    }
  }

  if (field.key === 'phone' || field.key === 'email') {
    nextDetails = withBookingEmail(nextDetails)
    const lookup = await enrichDetailsFromHubSpot(nextDetails)
    nextDetails = lookup.details
    booking = { ...booking, hubspotContact: lookup.contact }
  }

  if (booking.selectedOption) {
    const nextFinalMissingFieldIndex = findMissingBookingFieldIndex(
      nextDetails,
      FINAL_BOOKING_FIELD_KEYS,
    )

    if (nextFinalMissingFieldIndex !== -1) {
      const message =
        nextFinalMissingFieldIndex === booking.currentFieldIndex
          ? getClarifyingBookingQuestion(nextFinalMissingFieldIndex, content, customerLanguage)
          : getBookingQuestion(nextFinalMissingFieldIndex, nextDetails, customerLanguage)

      return {
        nextBooking: {
          ...booking,
          details: nextDetails,
          currentFieldIndex: nextFinalMissingFieldIndex,
        },
        message,
      }
    }

    const booked = await hubspotService.bookMeeting({
      customer: normalizeBookingDetails(withBookingEmail(nextDetails)),
      option: booking.selectedOption,
    })

    return {
      nextBooking: INITIAL_BOOKING,
      message: bookingText(customerLanguage, 'booked', { display: booked.display }),
    }
  }

  const nextMissingFieldIndex = findMissingBookingFieldIndex(nextDetails, AVAILABILITY_FIELD_KEYS)

  if (nextMissingFieldIndex !== -1) {
    const message =
      nextMissingFieldIndex === booking.currentFieldIndex
        ? getClarifyingBookingQuestion(nextMissingFieldIndex, content, customerLanguage)
        : getBookingQuestion(nextMissingFieldIndex, nextDetails, customerLanguage)

    return {
      nextBooking: {
        ...booking,
        details: nextDetails,
        currentFieldIndex: nextMissingFieldIndex,
      },
      message,
    }
  }

  return await prepareAvailabilityResponse({
    booking,
    details: withBookingEmail(nextDetails),
    customerLanguage,
  })
}

async function prepareAvailabilityResponse({ booking, details, intro = '', customerLanguage }) {
  const options = await hubspotService.getAvailability({
    preferredTime: details.preferredTime,
    preferredSpecialist: details.preferredSpecialist,
  })

  if (options.length === 0) {
    return {
      nextBooking: INITIAL_BOOKING,
      message: bookingText(customerLanguage, 'noAvailability'),
    }
  }

  return {
    nextBooking: {
      ...booking,
      details: withBookingEmail(details),
      options,
    },
    message: [
      ...(intro ? [intro, ''] : []),
      bookingText(customerLanguage, 'availabilityIntro'),
      '',
      ...options.map((option) => `${option.id}. ${option.display}`),
      '',
      bookingText(customerLanguage, 'availabilityChoice'),
    ].join('\n'),
  }
}

function getBookingQuestion(fieldIndex, details, customerLanguage) {
  const field = BOOKING_FIELDS[fieldIndex]

  if (field.key === 'preferredLanguage' && details.firstName) {
    return bookingText(customerLanguage, 'preferredLanguageWithName', { firstName: details.firstName })
  }

  if (field.key === 'desiredTreatment') {
    return bookingText(customerLanguage, 'desiredTreatment')
  }

  if (field.key === 'preferredTime' && details.desiredTreatment) {
    return bookingText(customerLanguage, 'preferredTimeForTreatment', {
      desiredTreatment: details.desiredTreatment,
    })
  }

  return bookingText(customerLanguage, field.key)
}

function getClarifyingBookingQuestion(fieldIndex, content, customerLanguage) {
  const field = BOOKING_FIELDS[fieldIndex]

  if (field.key === 'desiredTreatment') {
    return bookingText(customerLanguage, 'clarifyDesiredTreatment', { content })
  }

  return bookingText(customerLanguage, field.key)
}

async function enrichDetailsFromHubSpot(details) {
  if (!details.email) {
    return { details, contact: null }
  }

  const result = await hubspotService.lookupContact({ email: details.email })
  const properties = result.contact?.properties

  if (!result.exists || !properties) {
    return { details, contact: null }
  }

  return {
    contact: result.contact,
    details: {
      ...details,
      firstName: details.firstName || properties.firstname || '',
      lastName: details.lastName || properties.lastname || '',
      phone: details.phone || properties.phone || '',
      state: details.state || properties.state || '',
    },
  }
}

function isBookingIntent(content) {
  return /\b(book|schedule|appointment|consultation|meeting|call|available|availability|agendar|cita|consulta|reuni[oó]n|marcar|hor[aá]rio|consulta)\b/i.test(
    content,
  )
}

function isSchedulingPrompt(content) {
  return /\b(book|schedule|appointment|consultation|meeting|call|available|availability|time|day|cita|consulta|agendar|horario)\b/i.test(
    content,
  )
}

function extractBookingMemory(content) {
  return {
    email: extractEmail(content),
    phone: extractPhone(content),
    state: extractState(content),
    preferredTime: extractPreferredTime(content),
    preferredLanguage: extractPreferredLanguage(content),
    desiredTreatment: extractDesiredTreatment(content),
  }
}

function extractBookingMemoryFromMessages(messages) {
  return messages
    .filter((message) => message.role === 'user')
    .reduce(
      (memory, message) => mergeBookingDetails(memory, extractBookingMemory(message.content || '')),
      {},
    )
}

function mergeBookingDetails(currentDetails, nextDetails) {
  const merged = { ...currentDetails }

  for (const [key, value] of Object.entries(nextDetails)) {
    if (value && !merged[key]) {
      merged[key] = value
    }
  }

  return merged
}

function withDefaultDesiredTreatment(details) {
  return {
    ...details,
    desiredTreatment: details.desiredTreatment || DEFAULT_DESIRED_TREATMENT,
  }
}

function collectBookingField(details, key, content) {
  const nextDetails = { ...details }

  if (key === 'name') {
    const parts = cleanNameContent(content).split(/\s+/)
    nextDetails.firstName = parts[0] || ''
    nextDetails.lastName = parts.slice(1).join(' ')
    return nextDetails
  }

  if (key === 'email') {
    nextDetails.email = extractEmail(content) || content.trim()
    return nextDetails
  }

  if (key === 'phone') {
    nextDetails.phone = extractPhone(content) || content.trim()
    nextDetails.email = nextDetails.email || createDummyEmailFromPhone(nextDetails.phone)
    return nextDetails
  }

  if (key === 'preferredLanguage') {
    nextDetails.preferredLanguage = extractPreferredLanguage(content) || normalizeLanguage(content)
    return nextDetails
  }

  if (key === 'desiredTreatment') {
    nextDetails.desiredTreatment = extractDesiredTreatment(content)
    return nextDetails
  }

  if (key === 'state') {
    nextDetails.state = extractState(content) || content.trim()
  }

  if (key === 'preferredTime') {
    nextDetails.preferredTime = extractPreferredTime(content) || content.trim()
  }

  return nextDetails
}

function findMissingBookingFieldIndex(details, fieldKeys = BOOKING_FIELDS.map((item) => item.key)) {
  return BOOKING_FIELDS.findIndex(
    (item) => fieldKeys.includes(item.key) && !hasBookingField(details, item.key),
  )
}

function hasBookingField(details, key) {
  if (key === 'name') {
    return Boolean(details.firstName && details.lastName)
  }

  if (key === 'email') {
    return Boolean(details.email && details.email.includes('@'))
  }

  return Boolean(details[key])
}

function normalizeBookingDetails(details) {
  const bookingDetails = withBookingEmail(withDefaultDesiredTreatment(details))

  return {
    firstName: bookingDetails.firstName,
    lastName: bookingDetails.lastName,
    email: bookingDetails.email,
    phone: bookingDetails.phone,
    preferredLanguage: bookingDetails.preferredLanguage,
    desiredTreatment: bookingDetails.desiredTreatment,
    state: bookingDetails.state,
    preferredTime: bookingDetails.preferredTime,
  }
}

function withBookingEmail(details) {
  if (!details.phone) {
    return details
  }

  return {
    ...details,
    email: createDummyEmailFromPhone(details.phone),
  }
}

function createDummyEmailFromPhone(phone) {
  const digits = normalizePhoneDigitsForEmail(phone)

  if (!digits) {
    return ''
  }

  return `${digits}@dummy.com`
}

function normalizePhoneDigitsForEmail(phone) {
  const digits = String(phone || '').replace(/\D/g, '')

  if (digits.length === 10) {
    return `1${digits}`
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return digits
  }

  return digits
}

function normalizeLanguage(content) {
  const normalized = content.toLowerCase()

  if (normalized.includes('spanish') || normalized.includes('español') || normalized.includes('espanol')) {
    return 'Latin American Spanish'
  }

  if (normalized.includes('portuguese') || normalized.includes('português') || normalized.includes('portugues')) {
    return 'Portuguese'
  }

  return 'English'
}

function pickAvailabilityOption(content, options) {
  const selectedId = content.match(/\d+/)?.[0]
  return options.find((option) => option.id === selectedId)
}

function extractAvailabilityChangeRequest(content) {
  const preferredSpecialist = extractPreferredSpecialist(content)
  const preferredTime = extractPreferredTime(content)
  const details = {}
  const changes = []

  if (preferredSpecialist) {
    details.preferredSpecialist = preferredSpecialist
    changes.push(`Specialist ${preferredSpecialist}`)
  }

  if (preferredTime) {
    details.preferredTime = preferredTime
    changes.push(preferredTime)
  }

  return {
    hasChange: changes.length > 0,
    details,
    changes,
  }
}

function extractPreferredSpecialist(content) {
  const normalized = content.toLowerCase()
  const specialists = [
    ['Meribet', /\bmeribet\b/i],
    ['Leonardo', /\b(leonardo|leo)\b/i],
    ['Maria Claudia', /\b(maria claudia|claudia)\b/i],
    ['Andres', /\bandres\b/i],
    ['Alejandro', /\balejandro\b/i],
    ['Diana', /\bdiana\b/i],
  ]
  const match = specialists.find(([, pattern]) => pattern.test(normalized))

  return match?.[0] || ''
}

function extractEmail(content) {
  return content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || ''
}

function extractPhone(content) {
  return content.match(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4,}/)?.[0] || ''
}

function extractDesiredTreatment(content) {
  const normalized = content.toLowerCase()
  const searchable = normalizeTreatmentSearchText(content)
  const compact = searchable.replace(/\s+/g, '')

  if (/\b(zep|zepbound)\b/.test(searchable)) {
    return 'Zepbound'
  }

  if (
    /\b(weight loss|lose weight|losing weight|slim down|slimming|fat loss|bajar de peso|perder peso|glp 1|semaglutide|tirzepatide|wegovy|shot|shots|injection|injections|injectable|medication|meds)\b/.test(
      searchable,
    ) ||
    /(weightloss|loseweight|losingweight|fatloss|slimdown|glp1)/.test(compact)
  ) {
    return 'Weight Loss Injections'
  }

  if (/\b(nutri|nutrition|nutritionist|nutritional|diet|dietitian|meal plan|food plan|consult|consultation|consulta|asesoria nutricional|nutricion)\b/.test(searchable)) {
    return 'Nutrition Consultation'
  }

  if (/\b(supp|supps|supplement|supplements|vitamin|vitamins|protein|collagen|greens|probiotic|suplemento|suplementos)\b/.test(searchable)) {
    return 'Supplements'
  }

  if (/\b(nutri|consult|consultation)\b/i.test(normalized)) {
    return 'Nutrition Consultation'
  }

  if (/\bzepbound\b/i.test(normalized)) {
    return 'Zepbound'
  }

  if (
    /\b(glp-?1|semaglutide|tirzepatide|wegovy|injection|injectable|shot|weight loss|lose weight|bajar de peso|perder peso)\b/i.test(
      normalized,
    )
  ) {
    return 'Weight Loss Injections'
  }

  if (/\b(supplement|supplements|vitamin|protein|collagen|greens|probiotic|suplemento|suplementos)\b/i.test(normalized)) {
    return 'Supplements'
  }

  if (/\b(nutrition|nutritionist|diet|meal plan|consulta nutricional|nutrici[oó]n)\b/i.test(normalized)) {
    return 'Nutrition Consultation'
  }

  return ''
}

function normalizeTreatmentSearchText(content) {
  return String(content || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function cleanNameContent(content) {
  return content
    .replace(extractEmail(content), '')
    .replace(extractPhone(content), '')
    .split(',')[0]
    .trim()
}

function extractPreferredLanguage(content) {
  const normalized = content.toLowerCase()

  if (normalized.includes('spanish') || normalized.includes('español') || normalized.includes('espanol')) {
    return 'Latin American Spanish'
  }

  if (normalized.includes('portuguese') || normalized.includes('português') || normalized.includes('portugues')) {
    return 'Portuguese'
  }

  if (normalized.includes('english') || normalized.includes('inglés') || normalized.includes('ingles')) {
    return 'English'
  }

  return ''
}

function extractPreferredTime(content) {
  const dateTimeMatch = content.match(
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:\s+(?:at\s+)?)?(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?\b|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?(?:\s+(?:at\s+)?)?(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?\b/i,
  )

  if (dateTimeMatch) {
    return dateTimeMatch[0].trim()
  }

  const timeMatch = content.match(/\b(?:1[0-2]|0?[1-9])(?::\d{2})?\s*(?:am|pm)\b/i)

  if (timeMatch) {
    return timeMatch[0]
  }

  const ordinalDayMatch = content.match(/\b\d{1,2}(?:st|nd|rd|th)\b/i)

  if (ordinalDayMatch) {
    return ordinalDayMatch[0]
  }

  const dayPartMatch = content.match(/\b(today|tomorrow|morning|afternoon|evening|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\b/i)

  return dayPartMatch?.[0] || ''
}

function extractState(content) {
  const normalized = content.toLowerCase()

  return (
    US_STATES.find((state) => normalized.includes(state.toLowerCase())) ||
    extractNonServiceableLocation(content) ||
    ''
  )
}

function extractNonServiceableLocation(content) {
  const searchable = normalizeTreatmentSearchText(content)

  return (
    NON_SERVICEABLE_LOCATIONS.find((location) => {
      const normalizedLocation = normalizeTreatmentSearchText(location)

      return new RegExp(`\\b${normalizedLocation}\\b`).test(searchable)
    }) || ''
  )
}

function bookingMemoryFromRespondContact(contact) {
  const customFields = Object.fromEntries(
    (contact?.custom_fields || []).map((field) => [field.name, field.value]),
  )

  return {
    firstName: contact?.firstName || '',
    lastName: contact?.lastName || '',
    email: isPlaceholderEmail(contact?.email) ? '' : contact?.email || '',
    phone: contact?.phone || '',
    state: customFields.state || '',
    preferredLanguage: normalizeRespondLanguage(contact?.language),
  }
}

function isPlaceholderEmail(email) {
  return /@dummy\.com$/i.test(String(email || ''))
}

function normalizeRespondLanguage(language) {
  if (language === 'es') {
    return 'Latin American Spanish'
  }

  if (language === 'pt') {
    return 'Portuguese'
  }

  if (language === 'en') {
    return 'English'
  }

  return ''
}

export function ChatProvider({ children }) {
  const { activeAgent } = useAgent()
  const [activeConversationId, setActiveConversationId] = useState(null)
  const [messages, setMessages] = useState([
    createMessage('agent', LANGUAGE_QUESTION),
  ])
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState(null)
  const [booking, setBooking] = useState(INITIAL_BOOKING)
  const [bookingMemory, setBookingMemory] = useState({})
  const [sessionLanguage, setSessionLanguage] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const contactId =
      params.get('respondContactId') || params.get('respondId') || params.get('contactId')

    if (!contactId) {
      return
    }

    let isActive = true

    respondService
      .lookupContact({ contactId })
      .then((contact) => {
        if (!isActive) {
          return
        }

        setBookingMemory((currentMemory) =>
          mergeBookingDetails(currentMemory, bookingMemoryFromRespondContact(contact)),
        )
      })
      .catch(() => {
        if (isActive) {
          setError('Unable to load Respond customer details.')
        }
      })

    return () => {
      isActive = false
    }
  }, [])

  const sendMessage = useCallback(
    async (content) => {
      const trimmedContent = content.trim()

      if (!trimmedContent || isSending) {
        return
      }

      const userMessage = createMessage('user', trimmedContent)
      const nextMessages = [...messages, userMessage]
      const detectedLanguage = extractPreferredLanguage(trimmedContent) || detectCustomerSessionLanguage(trimmedContent)
      const nextSessionLanguage = detectedLanguage || sessionLanguage || 'English'

      setMessages(nextMessages)
      setIsSending(true)
      setError(null)
      setSessionLanguage(nextSessionLanguage)

      try {
        if (!sessionLanguage && detectedLanguage) {
          const greeting = getInitialGreeting(nextSessionLanguage)
          const stateQuestion = getInitialStateQuestion(nextSessionLanguage)

          setMessages((currentMessages) => [
            ...currentMessages,
            createMessage('agent', greeting),
            createMessage('agent', stateQuestion),
          ])
          return
        }

        const nextBookingMemory = mergeBookingDetails(
          bookingMemory,
          extractBookingMemory(trimmedContent),
        )
        setBookingMemory(nextBookingMemory)

        if (shouldUseOutOfStatePrescribedSnippet(nextBookingMemory)) {
          setBooking((currentBooking) => ({
            ...currentBooking,
            active: true,
            details: nextBookingMemory,
            outOfStateNotified: true,
          }))
          setMessages((currentMessages) => [
            ...currentMessages,
            createMessage('agent', outOfStatePrescribedText(nextSessionLanguage)),
          ])
          return
        }

        const bookingResponse = await handleBookingMessage(
          trimmedContent,
          booking,
          nextBookingMemory,
          messages,
          nextSessionLanguage,
        )

        if (bookingResponse) {
          setBooking(bookingResponse.nextBooking)
          setBookingMemory((currentMemory) =>
            mergeBookingDetails(currentMemory, bookingResponse.nextBooking.details || {}),
          )
          setMessages((currentMessages) => [
            ...currentMessages,
            createMessage('agent', bookingResponse.message),
          ])
          return
        }

        const result = await openaiService.createResponse({
          agent: activeAgent,
          messages: nextMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          customerLanguage: nextSessionLanguage,
        })

        const agentMessage = createMessage(
          'agent',
          result.text || result.message?.content || 'I am sorry, I could not generate a response.',
        )

        setMessages((currentMessages) => [...currentMessages, agentMessage])
      } catch (sendError) {
        setError(sendError.message || 'Unable to send message.')
        setMessages((currentMessages) => [
          ...currentMessages,
          createMessage(
            'agent',
            booking.active && sendError.message
              ? `I could not confirm the booking. ${sendError.message}`
              : booking.active
                ? 'I could not complete the booking right now. Please try another time option or let our team schedule it manually.'
                : 'I could not reach the AI service right now. Please check the API server and try again.',
          ),
        ])
      } finally {
        setIsSending(false)
      }
    },
    [activeAgent, booking, bookingMemory, isSending, messages, sessionLanguage],
  )

  const resetConversation = useCallback(() => {
    setMessages([createMessage('agent', LANGUAGE_QUESTION)])
    setError(null)
    setBooking(INITIAL_BOOKING)
    setBookingMemory({})
    setSessionLanguage('')
    setActiveConversationId(null)
  }, [])

  const value = useMemo(
    () => ({
      activeConversationId,
      error,
      isSending,
      messages,
      resetConversation,
      sendMessage,
      setActiveConversationId,
    }),
    [activeConversationId, error, isSending, messages, resetConversation, sendMessage],
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}
