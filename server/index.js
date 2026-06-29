import http from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { loadLocalEnv } from './env.js'
import {
  bookPrioritySellerMeeting,
  findHubSpotContactByEmail,
  getPrioritySellerAvailability,
} from './hubspotService.js'
import { formatKnowledgeContext, ingestKnowledgeFolder, searchKnowledge } from './ragService.js'
import { getRespondContact, sendRespondTextMessage } from './respondService.js'

const PORT = Number(process.env.PORT || process.env.API_PORT || 8787)
const DEFAULT_MODEL = 'gpt-4.1-mini'
const DIST_DIR = resolve(process.cwd(), 'dist')
const RESPOND_AGENT = {
  id: 'sales',
  systemPrompt:
    process.env.RESPOND_AGENT_SYSTEM_PROMPT ||
    'You are Maria from Dharma Clinic. You help inbound customers politely, answer from company knowledge, collect the next missing detail, and keep the conversation moving toward a free consultation when appropriate.',
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
const respondSessions = new Map()

const MIME_TYPES = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
}

loadLocalEnv()

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    const pathname = url.pathname

    if (request.method === 'GET' && (pathname === '/api/health' || pathname === '/health')) {
      sendJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'POST' && pathname === '/api/chat') {
      await handleChat(request, response)
      return
    }

    if (request.method === 'POST' && pathname === '/api/knowledge/ingest') {
      await handleKnowledgeIngest(request, response)
      return
    }

    if (request.method === 'POST' && pathname === '/api/knowledge/search') {
      await handleKnowledgeSearch(request, response)
      return
    }

    if (request.method === 'POST' && pathname === '/api/hubspot/availability') {
      await handleHubSpotAvailability(request, response)
      return
    }

    if (request.method === 'POST' && pathname === '/api/hubspot/book-meeting') {
      await handleHubSpotBookMeeting(request, response)
      return
    }

    if (request.method === 'POST' && pathname === '/api/hubspot/contact-lookup') {
      await handleHubSpotContactLookup(request, response)
      return
    }

    if (request.method === 'POST' && pathname === '/api/respond/contact-lookup') {
      await handleRespondContactLookup(request, response)
      return
    }

    if (request.method === 'POST' && pathname === '/api/respond/webhook') {
      await handleRespondWebhook(request, response, url)
      return
    }

    if (request.method === 'GET') {
      await serveStaticFile(pathname, response)
      return
    }

    sendJson(response, 404, { error: 'Not found' })
  } catch (error) {
    console.error(error)
    sendJson(response, 500, { error: error.message || 'Internal server error' })
  }
})

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`)
})

async function serveStaticFile(pathname, response) {
  const normalizedPath = pathname === '/' ? '/index.html' : pathname
  const requestedPath = resolve(DIST_DIR, `.${decodeURIComponent(normalizedPath)}`)
  const indexPath = join(DIST_DIR, 'index.html')
  const filePath =
    requestedPath.startsWith(DIST_DIR) && existsSync(requestedPath)
      ? requestedPath
      : indexPath

  if (!existsSync(filePath)) {
    sendJson(response, 404, { error: 'Frontend build not found. Run npm run build first.' })
    return
  }

  response.writeHead(200, {
    'Content-Type': MIME_TYPES[extname(filePath)] || 'application/octet-stream',
  })

  createReadStream(filePath).pipe(response)
}

async function handleChat(request, response) {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    sendJson(response, 500, { error: 'OPENAI_API_KEY is not configured.' })
    return
  }

  const body = await readJsonBody(request)
  const model = body.model || process.env.OPENAI_MODEL || DEFAULT_MODEL
  const ragContext = await buildRagContext(body)
  const customerLanguage = resolveCustomerLanguage(body)
  const redundancyControl = buildRedundancyControl(body)
  const instructions = buildInstructions({ ...body, customerLanguage, redundancyControl })
  const input = buildInput({
    ...body,
    customerLanguage,
    redundancyControl,
    context: [body.context, ragContext].filter(Boolean).join('\n\n'),
  })

  const text = await createOpenAIResponseText({ model, instructions, input })

  sendJson(response, 200, {
    model,
    text,
    message: {
      role: 'agent',
      content: text,
    },
  })
}

async function createOpenAIResponseText({ model, instructions, input }) {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured.')
  }

  const openaiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      instructions,
      input,
    }),
  })

  const data = await openaiResponse.json()

  if (!openaiResponse.ok) {
    throw new Error(data.error?.message || 'OpenAI request failed.')
  }

  return extractOutputText(data)
}

async function handleKnowledgeIngest(request, response) {
  const body = await readJsonBody(request)
  const results = await ingestKnowledgeFolder({
    bucket: body.bucket,
    prefix: body.prefix,
    agentId: body.agentId || 'sales',
    sourceType: body.sourceType,
  })

  sendJson(response, 200, {
    indexedFiles: results.length,
    results,
  })
}

async function handleKnowledgeSearch(request, response) {
  const body = await readJsonBody(request)
  const matches = await searchKnowledge({
    query: body.query,
    agentId: body.agentId || 'sales',
    sourceTypes: body.sourceTypes,
    matchCount: body.matchCount,
  })

  sendJson(response, 200, { matches })
}

async function handleHubSpotAvailability(request, response) {
  const body = await readJsonBody(request)
  const options = await getPrioritySellerAvailability({
    limit: body.limit || 6,
    preferredTime: body.preferredTime,
    preferredSpecialist: body.preferredSpecialist,
  })

  sendJson(response, 200, { options })
}

async function handleHubSpotBookMeeting(request, response) {
  const body = await readJsonBody(request)
  const booking = await bookPrioritySellerMeeting({
    customer: body.customer,
    option: body.option,
  })

  sendJson(response, 200, { booking })
}

async function handleHubSpotContactLookup(request, response) {
  const body = await readJsonBody(request)
  const contact = await findHubSpotContactByEmail(body.email)

  sendJson(response, 200, {
    exists: Boolean(contact),
    contact: contact
      ? {
          id: contact.id,
          properties: contact.properties,
        }
      : null,
  })
}

async function handleRespondContactLookup(request, response) {
  const body = await readJsonBody(request)
  const contact = await getRespondContact(body.contactId)

  sendJson(response, 200, { contact })
}

async function handleRespondWebhook(request, response) {
  const rawBody = await readRawBody(request)

  if (!isValidRespondWebhookRequest(request, rawBody)) {
    sendJson(response, 401, { error: 'Invalid webhook signature.' })
    return
  }

  const body = parseJsonBody(rawBody)
  const event = normalizeRespondWebhookEvent(body)

  if (!isAllowedRespondChannel(event.channelId)) {
    sendJson(response, 200, {
      ok: true,
      skipped: true,
      reason: event.channelId
        ? `Ignoring channel ${event.channelId}.`
        : 'No channel ID found on webhook event.',
    })
    return
  }

  if (!event.contactId || !event.text || !event.isIncoming) {
    sendJson(response, 200, {
      ok: true,
      skipped: true,
      reason: event.skipReason || 'No incoming text message found.',
    })
    return
  }

  sendJson(response, 200, { ok: true, accepted: true })

  processRespondIncomingMessage(event).catch((error) => {
    console.error('Respond webhook processing failed:', error)
  })
}

function isValidRespondWebhookRequest(request, rawBody) {
  const signingKey = process.env.RESPOND_WEBHOOK_SIGNING_KEY

  if (!signingKey) {
    return true
  }

  const signature =
    request.headers['x-webhook-signature'] ||
    request.headers['x-respond-signature'] ||
    request.headers['respond-signature'] ||
    request.headers['x-signature']

  if (!signature || Array.isArray(signature)) {
    return false
  }

  return verifyWebhookSignature({
    signingKey,
    rawBody,
    signature,
  })
}

function verifyWebhookSignature({ signingKey, rawBody, signature }) {
  const normalizedSignature = normalizeSignature(signature)
  const keyCandidates = [Buffer.from(signingKey, 'utf8')]

  try {
    keyCandidates.push(Buffer.from(signingKey, 'base64'))
  } catch {
    // The signing key may be plain text rather than base64.
  }

  const digestEncodings = ['hex', 'base64']

  for (const key of keyCandidates) {
    for (const encoding of digestEncodings) {
      const expected = createHmac('sha256', key).update(rawBody).digest(encoding)

      if (constantTimeEquals(normalizedSignature, normalizeSignature(expected))) {
        return true
      }
    }
  }

  return false
}

function normalizeSignature(signature) {
  return String(signature || '').trim().replace(/^sha256=/i, '')
}

function constantTimeEquals(left, right) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function isAllowedRespondChannel(channelId) {
  const allowedChannelIds = parseCsvEnv(process.env.RESPOND_ALLOWED_CHANNEL_IDS)

  if (allowedChannelIds.length === 0) {
    return true
  }

  return Boolean(channelId && allowedChannelIds.includes(String(channelId)))
}

function parseCsvEnv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

async function processRespondIncomingMessage(event) {
  const session = getRespondSession(event.contactId)
  const userMessage = {
    role: 'user',
    content: event.text,
  }

  if (session.messages.length === 0) {
    await sendRespondTextMessage({
      contactId: event.contactId,
      channelId: event.channelId,
      text: INITIAL_GREETING,
    })

    respondSessions.set(event.contactId, {
      customerLanguage: 'Latin American Spanish',
      messages: [userMessage, { role: 'agent', content: INITIAL_GREETING }],
    })
    return
  }

  const messages = [...session.messages, userMessage].slice(-12)
  const customerLanguage =
    session.customerLanguage || resolveCustomerLanguage({ messages, message: event.text }) || 'English'
  const ragContext = await buildRagContext({
    agent: RESPOND_AGENT,
    messages,
    message: event.text,
  })
  const redundancyControl = buildRedundancyControl({ messages })
  const instructions = buildInstructions({
    agent: RESPOND_AGENT,
    customerLanguage,
    redundancyControl,
  })
  const input = buildInput({
    messages,
    customerLanguage,
    redundancyControl,
    context: ragContext,
  })
  const text = await createOpenAIResponseText({
    model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
    instructions,
    input,
  })

  await sendRespondTextMessage({
    contactId: event.contactId,
    channelId: event.channelId,
    text,
  })

  respondSessions.set(event.contactId, {
    customerLanguage,
    messages: [...messages, { role: 'agent', content: text }].slice(-12),
  })
}

function getRespondSession(contactId) {
  return respondSessions.get(contactId) || {
    customerLanguage: '',
    messages: [],
  }
}

function normalizeRespondWebhookEvent(body) {
  const message = body.message || body.data?.message || body.messages?.[0] || body.data?.messages?.[0] || {}
  const contact = body.contact || body.data?.contact || message.contact || {}
  const text = extractRespondWebhookText(message)
  const traffic = message.traffic || body.traffic || body.data?.traffic || ''
  const direction = message.direction || body.direction || body.data?.direction || ''
  const eventName = body.event || body.eventName || body.type || body.data?.event || ''
  const isOutgoing =
    traffic === 'outgoing' ||
    direction === 'outgoing' ||
    /outgoing|sent|delivered|read/i.test(eventName)

  return {
    contactId:
      String(
        contact.id ||
          contact.contactId ||
          body.contactId ||
          body.respondContactId ||
          body.data?.contactId ||
          message.contactId ||
          '',
      ).trim(),
    channelId:
      message.channelId ||
      message.channel?.id ||
      body.channelId ||
      body.data?.channelId ||
      body.channel?.id ||
      '',
    isIncoming: !isOutgoing,
    skipReason: isOutgoing ? 'Ignoring outbound Respond message.' : '',
    text,
  }
}

function extractRespondWebhookText(message) {
  const candidates = [
    message.text,
    message.message?.text,
    message.message?.body,
    message.body,
    message.content,
    message.message,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return ''
}

function buildInstructions({ agent, instructions, customerLanguage, redundancyControl }) {
  return [
    agent?.systemPrompt,
    customerLanguage
      ? `Session language lock: ${customerLanguage}. You must answer only in ${customerLanguage} for this conversation. Do not switch languages because retrieved examples, company context, prior agent messages, or internal notes use another language.`
      : '',
    redundancyControl,
    'Redundancy control is mandatory: do not ask for a detail the customer already provided in this conversation, and do not repeat prices, product lists, or onboarding explanations already shown unless the customer explicitly asks for them again. If a prior agent message asked for multiple details and the customer supplied one of them, acknowledge the supplied detail and ask only for the missing detail.',
    'Use retrieved company knowledge as supporting context when it is relevant. Do not mention internal source names unless asked. If context is missing, ask a clarifying question or route to a human instead of inventing facts.',
    'Retrieved examples are examples of workflow only. They never override the session language lock.',
    'When retrieved raw conversation examples are relevant, mirror their decision pattern and workflow, but do not copy the example language. Always answer in the customer’s current language. Do not expose internal notes or claim the example conversation is part of the current chat.',
    'Never claim that an appointment is booked, scheduled, confirmed, or reserved unless the application booking flow has already returned a successful HubSpot booking confirmation.',
    instructions,
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim()
}

function buildInput({ messages = [], context, message, customerLanguage, redundancyControl }) {
  const parts = []

  if (customerLanguage) {
    parts.push(`Session language lock for the next reply: ${customerLanguage}`)
  }

  if (redundancyControl) {
    parts.push(redundancyControl)
  }

  if (context) {
    parts.push(`Relevant company context:\n${context}`)
  }

  if (message) {
    parts.push(`Customer message:\n${message}`)
  }

  if (messages.length > 0) {
    const conversation = messages
      .map((item) => `${item.role || 'user'}: ${item.content || ''}`)
      .join('\n')

    parts.push(`Conversation:\n${conversation}`)
  }

  return parts.join('\n\n').trim() || 'Start the conversation with a helpful greeting.'
}

function buildRedundancyControl({ messages = [] }) {
  if (!messages.length) {
    return ''
  }

  const userMessages = messages.filter((item) => item.role === 'user').map((item) => item.content || '')
  const agentMessages = messages.filter((item) => item.role === 'agent').map((item) => item.content || '')
  const knownDetails = extractKnownCustomerDetails(userMessages)
  const shownTopics = extractShownAgentTopics(agentMessages)
  const priorQuestions = extractPriorQuestions(agentMessages)
  const lines = [
    'Redundancy control context:',
    knownDetails.length ? `Known customer details: ${knownDetails.join('; ')}` : '',
    shownTopics.length ? `Already shown by agent: ${shownTopics.join('; ')}` : '',
    priorQuestions.length ? `Questions already asked: ${priorQuestions.join(' | ')}` : '',
    'Next reply should advance the conversation with only the missing next step.',
  ].filter(Boolean)

  return lines.length > 2 ? lines.join('\n') : ''
}

function extractKnownCustomerDetails(userMessages) {
  const details = []
  const joined = userMessages.join('\n')
  const email = joined.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
  const phone = joined.match(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4,}/)?.[0]
  const state = extractStateName(joined)
  const language = extractPreferredLanguageName(joined)
  const preferredTime = extractPreferredTimeText(joined)
  const likelyName = [...userMessages].reverse().map(cleanLikelyName).find((text) => {
    const trimmed = text.trim()
    return /^[A-Za-z][A-Za-z' -]+$/.test(trimmed) && trimmed.split(/\s+/).length >= 2
  })

  if (state) {
    details.push(`state=${state}`)
  }

  if (preferredTime) {
    details.push(`preferred time=${preferredTime}`)
  }

  if (likelyName) {
    details.push(`name=${likelyName.trim()}`)
  }

  if (phone) {
    details.push(`phone=${phone}`)
  }

  if (email) {
    details.push(`email=${email}`)
  }

  if (language) {
    details.push(`preferred language=${language}`)
  }

  return details
}

function extractShownAgentTopics(agentMessages) {
  const joined = agentMessages.join('\n').toLowerCase()
  const topics = []

  if (/\$\s*589|glp-?1/.test(joined)) {
    topics.push('GLP-1 package price/details')
  }

  if (/\$\s*299|zepbound/.test(joined)) {
    topics.push('Zepbound prescription access price/details')
  }

  if (/free|gratuita|gratuito/.test(joined) && /call|consulta|consultation|videollamada/.test(joined)) {
    topics.push('free consultation call')
  }

  if (/instagram|@dharma\.clinic/.test(joined)) {
    topics.push('Instagram intro')
  }

  return topics
}

function cleanLikelyName(content) {
  const email = content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || ''
  const phone = content.match(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4,}/)?.[0] || ''

  return content.replace(email, '').replace(phone, '').split(',')[0].trim()
}

function extractPriorQuestions(agentMessages) {
  return agentMessages
    .flatMap((message) => message.match(/[^.!?\n]*\?/g) || [])
    .map((question) => question.trim())
    .filter(Boolean)
    .slice(-6)
}

function extractStateName(content) {
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

function extractPreferredLanguageName(content) {
  const normalized = content.toLowerCase()

  if (normalized.includes('spanish') || normalized.includes('espanol')) {
    return 'Latin American Spanish'
  }

  if (normalized.includes('portuguese') || normalized.includes('portugues')) {
    return 'Portuguese'
  }

  if (normalized.includes('english') || normalized.includes('ingles')) {
    return 'English'
  }

  return ''
}

function extractPreferredTimeText(content) {
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

  return ''
}

function resolveCustomerLanguage({ messages = [], message, customerLanguage }) {
  const providedLanguage = normalizeLanguageName(customerLanguage)

  if (providedLanguage) {
    return providedLanguage
  }

  const userMessages = [
    ...messages.filter((item) => item.role === 'user').map((item) => item.content || ''),
    message || '',
  ].filter((content) => content.trim())

  for (const content of userMessages) {
    const detectedLanguage = detectCustomerLanguage(content)

    if (detectedLanguage) {
      return detectedLanguage
    }
  }

  return ''
}

function normalizeLanguageName(language) {
  const normalized = String(language || '').toLowerCase()

  if (normalized.includes('spanish') || normalized.includes('espanol') || normalized.includes('español')) {
    return 'Latin American Spanish'
  }

  if (normalized.includes('portuguese') || normalized.includes('portugues') || normalized.includes('português')) {
    return 'Portuguese'
  }

  if (normalized.includes('english') || normalized.includes('ingles') || normalized.includes('inglés')) {
    return 'English'
  }

  return ''
}

function detectCustomerLanguage(content) {
  const text = String(content || '').toLowerCase()

  if (!text.trim()) {
    return ''
  }

  const spanishSignals = [
    '¿',
    '¡',
    'quiero',
    'hola',
    'gracias',
    'cita',
    'agendar',
    'español',
    'espanol',
    'perder peso',
    'buenas',
    'estado',
    'llamada',
  ]
  const portugueseSignals = [
    'olá',
    'obrigado',
    'obrigada',
    'quero',
    'consulta',
    'agendar',
    'português',
    'portugues',
    'perder peso',
    'horário',
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
  ]

  if (spanishSignals.some((signal) => text.includes(signal))) {
    return 'Latin American Spanish'
  }

  if (portugueseSignals.some((signal) => text.includes(signal))) {
    return 'Portuguese'
  }

  if (englishSignals.some((signal) => text.includes(signal))) {
    return 'English'
  }

  if (/[a-z]/i.test(text) && !/[áéíóúñ¿¡ãõç]/i.test(text)) {
    return 'English'
  }

  return ''
}

async function buildRagContext({ agent, messages = [], message }) {
  const lastUserMessage =
    message ||
    [...messages].reverse().find((item) => item.role === 'user')?.content ||
    ''

  if (!lastUserMessage.trim()) {
    return ''
  }

  const matches = await searchKnowledge({
    query: lastUserMessage,
    agentId: agent?.id || 'sales',
  })

  return formatKnowledgeContext(matches)
}

function extractOutputText(data) {
  if (data.output_text) {
    return data.output_text
  }

  return (
    data.output
      ?.flatMap((item) => item.content || [])
      .filter((item) => item.type === 'output_text')
      .map((item) => item.text)
      .join('\n') || ''
  )
}

function readJsonBody(request) {
  return readRawBody(request).then(parseJsonBody)
}

function readRawBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let rawBody = ''

    request.on('data', (chunk) => {
      rawBody += chunk

      if (rawBody.length > 1_000_000) {
        request.destroy()
        rejectBody(new Error('Request body is too large.'))
      }
    })

    request.on('end', () => {
      resolveBody(rawBody)
    })
  })
}

function parseJsonBody(rawBody) {
  if (!rawBody) {
    return {}
  }

  try {
    return JSON.parse(rawBody)
  } catch {
    throw new Error('Invalid JSON body.')
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json',
  })

  response.end(JSON.stringify(payload))
}
