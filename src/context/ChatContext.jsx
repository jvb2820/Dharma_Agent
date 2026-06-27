import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAgent } from '../hooks/useAgent'
import { hubspotService } from '../services/hubspotService'
import { openaiService } from '../services/openaiService'
import { respondService } from '../services/respondService'
import { ChatContext } from './chat-context'

const BOOKING_FIELDS = [
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
]

const INITIAL_BOOKING = {
  active: false,
  currentFieldIndex: 0,
  details: {},
  options: [],
  hubspotContact: null,
}

const INITIAL_GREETING = `Hola, mi nombre es Maria, de la clínica Dharma. 👋 Es un placer tenerte aquí, echa un vistazo a nuestro Instagram *@dharma.clinic* 📸.

📍 Somos una empresa de telemedicina ubicada en EE.UU. y atendemos online en 43 estados.

💰*PRECIOS DE LOS MÁS VENDIDOS:*
• *$589* – Paquete de hasta 4 semanas de GLP-1 personalizado
• *$299* – Acceso a prescripción de Zepbound

Tenemos tratamientos más largos para que pueda alcanzar su objetivo.

📲 Primero realizamos una llamada de análisis *gratuita* por videollamada.

💥 *OFERTA ESPECIAL HOY* 💥

📍 En que *estado* reside para saber si podemos atenderle?`

function createMessage(role, content) {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
  }
}

async function handleBookingMessage(content, booking, memory, messages) {
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

    const nextMissingFieldIndex = findMissingBookingFieldIndex(details)

    if (nextMissingFieldIndex === -1) {
      return await prepareAvailabilityResponse({
        booking: { ...INITIAL_BOOKING, active: true, details, hubspotContact },
        details,
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
      message: getBookingQuestion(nextMissingFieldIndex, details),
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
          intro: requestedChange.message,
        })
      }

      return {
        nextBooking: booking,
        message:
          'Of course. If none of those feel right, tell me the day, time, or specialist you prefer and I will check again.',
      }
    }

    const booked = await hubspotService.bookMeeting({
      customer: normalizeBookingDetails(withBookingEmail(booking.details)),
      option: selectedOption,
    })

    return {
      nextBooking: INITIAL_BOOKING,
      message: `You are booked for ${booked.display}.`,
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

  if (field.key === 'phone' || field.key === 'email') {
    nextDetails = withBookingEmail(nextDetails)
    const lookup = await enrichDetailsFromHubSpot(nextDetails)
    nextDetails = lookup.details
    booking = { ...booking, hubspotContact: lookup.contact }
  }

  const nextMissingFieldIndex = findMissingBookingFieldIndex(nextDetails)

  if (nextMissingFieldIndex !== -1) {
    const message =
      nextMissingFieldIndex === booking.currentFieldIndex
        ? getClarifyingBookingQuestion(nextMissingFieldIndex, content)
        : getBookingQuestion(nextMissingFieldIndex, nextDetails)

    return {
      nextBooking: {
        ...booking,
        details: nextDetails,
        currentFieldIndex: nextMissingFieldIndex,
      },
      message,
    }
  }

  return await prepareAvailabilityResponse({ booking, details: withBookingEmail(nextDetails) })
}

async function prepareAvailabilityResponse({ booking, details, intro = '' }) {
  const options = await hubspotService.getAvailability({
    preferredTime: details.preferredTime,
    preferredSpecialist: details.preferredSpecialist,
  })

  if (options.length === 0) {
    return {
      nextBooking: INITIAL_BOOKING,
      message:
        'I am not seeing a matching opening for that preference right now. I can keep checking another day or specialist, or route this to the team so they can help schedule it manually.',
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
      'I found these appointment options for you:',
      '',
      ...options.map((option) => `${option.id}. ${option.display}`),
      '',
      'Which one feels best? You can reply with the number, or tell me a different day, time, or specialist.',
    ].join('\n'),
  }
}

function getBookingQuestion(fieldIndex, details) {
  const field = BOOKING_FIELDS[fieldIndex]

  if (field.key === 'preferredLanguage' && details.firstName) {
    return `Nice to meet you, ${details.firstName}. What language would you feel most comfortable using for the consultation: English, Spanish, or Portuguese?`
  }

  if (field.key === 'desiredTreatment') {
    return 'Got it. What are you mainly hoping to work on right now: losing weight, Zepbound, supplements, or nutrition guidance?'
  }

  if (field.key === 'preferredTime' && details.desiredTreatment) {
    return `That makes sense. For ${details.desiredTreatment}, what day or time would feel easiest for your free consultation?`
  }

  return field.question
}

function getClarifyingBookingQuestion(fieldIndex, content) {
  const field = BOOKING_FIELDS[fieldIndex]

  if (field.key === 'desiredTreatment') {
    return `I hear you. Just so I guide you the right way, when you say "${content}", is your main goal weight loss, Zepbound, supplements, or nutrition guidance?`
  }

  return field.question
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

function findMissingBookingFieldIndex(details) {
  return BOOKING_FIELDS.findIndex((item) => !hasBookingField(details, item.key))
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
  const bookingDetails = withBookingEmail(details)

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
  if (details.email || !details.phone) {
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
    message: changes.length ? `Absolutely, I will check options for ${changes.join(' on ')}.` : '',
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
  const states = [
    'Alabama',
    'Alaska',
    'Arizona',
    'Arkansas',
    'California',
    'Colorado',
    'Connecticut',
    'Delaware',
    'Florida',
    'Georgia',
    'Hawaii',
    'Idaho',
    'Illinois',
    'Indiana',
    'Iowa',
    'Kansas',
    'Kentucky',
    'Louisiana',
    'Maine',
    'Maryland',
    'Massachusetts',
    'Michigan',
    'Minnesota',
    'Mississippi',
    'Missouri',
    'Montana',
    'Nebraska',
    'Nevada',
    'New Hampshire',
    'New Jersey',
    'New Mexico',
    'New York',
    'North Carolina',
    'North Dakota',
    'Ohio',
    'Oklahoma',
    'Oregon',
    'Pennsylvania',
    'Rhode Island',
    'South Carolina',
    'South Dakota',
    'Tennessee',
    'Texas',
    'Utah',
    'Vermont',
    'Virginia',
    'Washington',
    'West Virginia',
    'Wisconsin',
    'Wyoming',
  ]
  const normalized = content.toLowerCase()

  return states.find((state) => normalized.includes(state.toLowerCase())) || ''
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
    createMessage('agent', INITIAL_GREETING),
  ])
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState(null)
  const [booking, setBooking] = useState(INITIAL_BOOKING)
  const [bookingMemory, setBookingMemory] = useState({})

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

      setMessages(nextMessages)
      setIsSending(true)
      setError(null)

      try {
        const nextBookingMemory = mergeBookingDetails(
          bookingMemory,
          extractBookingMemory(trimmedContent),
        )
        setBookingMemory(nextBookingMemory)
        const bookingResponse = await handleBookingMessage(
          trimmedContent,
          booking,
          nextBookingMemory,
          messages,
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
    [activeAgent, booking, bookingMemory, isSending, messages],
  )

  const resetConversation = useCallback(() => {
    setMessages([createMessage('agent', INITIAL_GREETING)])
    setError(null)
    setBooking(INITIAL_BOOKING)
    setBookingMemory({})
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
