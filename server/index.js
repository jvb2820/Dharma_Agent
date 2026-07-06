import http from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { buildBookedMessage } from './booked.js'
import { loadLocalEnv } from './env.js'
import { formatCustomerStateSlot, getCustomerStateHour } from './timezones.js'
import {
  NON_SERVICEABLE_LOCATIONS,
  US_STATES,
  isPrescribedTreatmentDeliveryState,
} from '../src/data/states.js'
import {
  bookCustomerServiceMeeting,
  bookPrioritySellerMeeting,
  findHubSpotContactByEmail,
  getCustomerServiceAvailability,
  getPrioritySellerAvailability,
} from './hubspotService.js'
import { formatKnowledgeContext, ingestKnowledgeFolder, searchKnowledge } from './ragService.js'
import {
  getRespondContact,
  sendRespondImageMessage,
  sendRespondTextMessage,
  updateRespondContact,
} from './respondService.js'

loadLocalEnv()

const PORT = Number(process.env.PORT || process.env.API_PORT || 8787)
const DEFAULT_MODEL = 'gpt-4.1-mini'
const DIST_DIR = resolve(process.cwd(), 'dist')
const RESPOND_AGENT = {
  id: 'sales',
  systemPrompt:
    process.env.RESPOND_AGENT_SYSTEM_PROMPT ||
    'You are Maria from Dharma Clinic. You help inbound customers politely, answer from company knowledge, collect the next missing detail, and guide qualified leads toward a free online discovery call when appropriate.',
}
const SESSION_RESTART_WINDOW_MS =
  Number(process.env.RESPOND_SESSION_RESTART_WINDOW_HOURS || 24) * 60 * 60 * 1000
const INITIAL_IMAGE_URL = process.env.RESPOND_INITIAL_IMAGE_URL || getDefaultInitialImageUrl()
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
  Portuguese: `Olá, meu nome é Maria, da clínica Dharma.

👋 É um prazer ter você aqui. Você também pode dar uma olhada no nosso Instagram *@dharma.clinic* 📸.

📍 Somos uma empresa de telemedicina localizada nos EUA e as consultas são online.

💰 *PREÇOS DOS MAIS VENDIDOS:*
- *$589* - Pacote de até 4 semanas de GLP-1 personalizado
- *$299* - Acesso à receita de Zepbound

Temos tratamentos mais longos para que você possa alcançar seu objetivo.

📲 Primeiro, realizamos uma chamada de análise *gratuita* por videochamada.

💥 *OFERTA ESPECIAL HOJE* 💥`,
}
const INITIAL_STATE_QUESTION_BY_LANGUAGE = {
  English: '📍Please tell us which state you live in to find out if we ship to your state?',
  'Latin American Spanish':
    '📍Dime por favor en que estado vives para saber si hacemos envios a su Estado?',
  Portuguese:
    '📍Por favor, me informe em que estado você mora para saber se fazemos entregas para o seu Estado?',
}
const respondSessions = new Map()

const MIME_TYPES = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
}

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

function getDefaultInitialImageUrl() {
  const baseUrl =
    process.env.WEB_SERVICE_URL ||
    process.env.VITE_WEB_SERVICE_URL ||
    'https://dharma-agent.onrender.com'

  return `${baseUrl.replace(/\/+$/, '')}/Images/before%20and%20after.png`
}

async function processRespondIncomingMessage(event) {
  const session = getRespondSession(event.contactId)
  let respondContactProfile =
    session.respondContactProfile || (await getRespondContactProfile(event.contactId))
  respondContactProfile = mergeRespondContactProfileFallbacks(respondContactProfile, {
    phone: event.contactPhone,
  })
  const userMessage = {
    role: 'user',
    content: event.text,
  }
  const detectedLanguage = resolveCustomerLanguage({
    messages: [userMessage],
    message: event.text,
  })
  const preferredLanguage =
    detectedLanguage ||
    session.customerLanguage ||
    respondContactProfile?.bookingDetails?.preferredLanguage ||
    ''

  if (shouldRestartRespondConversation(session)) {
    const initialLanguage = preferredLanguage || 'English'
    const initialDetails = {
      ...getRespondContactBookingDetails(respondContactProfile),
      ...extractRespondBookingDetailsFromText(event.text),
    }

    await sendInitialRespondSequence({
      contactId: event.contactId,
      channelId: event.channelId,
      customerLanguage: initialLanguage,
      firstName: getCustomerFirstName(initialDetails, respondContactProfile),
    })

    respondSessions.set(event.contactId, {
      customerLanguage: initialLanguage,
      languageAsked: false,
      lastInteractionAt: Date.now(),
      messages: [
        userMessage,
        {
          role: 'agent',
          content: getInitialGreeting(
            initialLanguage,
            getCustomerFirstName(initialDetails, respondContactProfile),
          ),
        },
        { role: 'agent', content: getInitialStateQuestion(initialLanguage) },
      ],
      booking: {
        bookingTeam: getBookingTeamForRespondContact(respondContactProfile),
        details: initialDetails,
        pendingField: 'state',
      },
      respondContactProfile,
    })
    return
  }

  if (session.languageAsked && preferredLanguage) {
    await sendInitialRespondSequence({
      contactId: event.contactId,
      channelId: event.channelId,
      customerLanguage: preferredLanguage,
      firstName: getCustomerFirstName(getRespondContactBookingDetails(respondContactProfile), respondContactProfile),
    })

    respondSessions.set(event.contactId, {
      customerLanguage: preferredLanguage,
      languageAsked: false,
      lastInteractionAt: Date.now(),
      messages: [
        ...session.messages,
        userMessage,
        {
          role: 'agent',
          content: getInitialGreeting(
            preferredLanguage,
            getCustomerFirstName(getRespondContactBookingDetails(respondContactProfile), respondContactProfile),
          ),
        },
        { role: 'agent', content: getInitialStateQuestion(preferredLanguage) },
      ].slice(-12),
      booking: {
        bookingTeam: getBookingTeamForRespondContact(respondContactProfile),
        details: getRespondContactBookingDetails(respondContactProfile),
        pendingField: 'state',
      },
      respondContactProfile,
    })
    return
  }

  const messages = [...session.messages, userMessage].slice(-12)
  const customerLanguage = preferredLanguage || 'English'
  const state = extractStateName(event.text)

  if (state) {
    await updateRespondContactState(event.contactId, state)
  }

  const bookingResponse = await handleRespondBookingAutomation({
    session,
    messages,
    customerLanguage,
    respondContactProfile,
  })

  if (bookingResponse) {
    await sendRespondTextMessage({
      contactId: event.contactId,
      channelId: event.channelId,
      text: bookingResponse.text,
    })

    respondSessions.set(event.contactId, {
      customerLanguage,
      languageAsked: false,
      lastInteractionAt: Date.now(),
      messages: [...messages, { role: 'agent', content: bookingResponse.text }].slice(-12),
      booking: bookingResponse.booking,
      respondContactProfile,
    })
    return
  }

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
    respondContactProfile,
    booking: session.booking,
  })
  const generatedText = await createOpenAIResponseText({
    model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
    instructions,
    input,
  })
  const text = preventUnconfirmedBookingReply(generatedText, customerLanguage, messages, session)

  await sendRespondTextMessage({
    contactId: event.contactId,
    channelId: event.channelId,
    text,
  })

  respondSessions.set(event.contactId, {
    customerLanguage,
    languageAsked: false,
    lastInteractionAt: Date.now(),
    messages: [...messages, { role: 'agent', content: text }].slice(-12),
    booking: session.booking || null,
    respondContactProfile,
  })
}

function getRespondSession(contactId) {
  return respondSessions.get(contactId) || {
    customerLanguage: '',
    languageAsked: false,
    lastInteractionAt: 0,
    messages: [],
    booking: null,
    respondContactProfile: null,
  }
}

async function getRespondContactProfile(contactId) {
  try {
    const contact = await getRespondContact(contactId)
    return classifyRespondContact(contact)
  } catch (error) {
    console.warn(`Unable to fetch Respond contact profile: ${error.message}`)
    return classifyRespondContact(null)
  }
}

function classifyRespondContact(contact) {
  if (!contact?.id) {
    return {
      status: 'new_or_no_record',
      label: 'New or no existing Respond record',
      reason: 'Respond contact lookup did not return a profile.',
      bookingDetails: {},
    }
  }

  const customFields = getRespondCustomFieldMap(contact)
  const tags = getRespondTagNames(contact)
  const bookingDetails = buildRespondContactBookingDetails({ contact, customFields })
  const leadStatus = customFields.lead_status || ''
  const classification = customFields.classification || ''
  const hubspotId = customFields.hubspot_id || ''
  const statusText = [
    leadStatus,
    classification,
    contact.lifecycle,
    contact.status,
    tags.join(' '),
  ]
    .filter(Boolean)
    .join(' ')

  if (/\b(client|cliente|patient|paciente|active|paid|current|recurring|old client)\b/i.test(statusText)) {
    return {
      status: 'returning_client',
      label: 'Returning client',
      reason: 'Respond fields or tags indicate an existing client/patient.',
      fields: buildRespondContactSignalSummary({ customFields, tags, contact }),
      bookingDetails,
    }
  }

  if (/\b(evaluation scheduled|scheduled|booked|appointment|cita|1st evaluation)\b/i.test(statusText)) {
    return {
      status: 'returning_lead',
      label: 'Returning lead',
      reason: 'Respond fields or tags indicate an existing scheduled/evaluated lead.',
      fields: buildRespondContactSignalSummary({ customFields, tags, contact }),
      bookingDetails,
    }
  }

  if (hubspotId) {
    return {
      status: 'existing_hubspot_contact',
      label: 'Existing HubSpot contact',
      reason: 'Respond contact has a hubspot_id custom field.',
      fields: buildRespondContactSignalSummary({ customFields, tags, contact }),
      bookingDetails,
    }
  }

  if (/\b(no response|closed|follow up|follow-up|followup)\b/i.test(statusText)) {
    return {
      status: 'returning_conversation',
      label: 'Returning conversation',
      reason: 'Respond fields indicate prior conversation handling, but not confirmed client status.',
      fields: buildRespondContactSignalSummary({ customFields, tags, contact }),
      bookingDetails,
    }
  }

  return {
    status: 'new_or_no_record',
    label: 'New or no existing record',
    reason: 'No current Respond fields indicate a prior client, lead, HubSpot record, or handled conversation.',
    fields: buildRespondContactSignalSummary({ customFields, tags, contact }),
    bookingDetails,
  }
}

function getRespondCustomFieldMap(contact) {
  return Object.fromEntries(
    (contact?.custom_fields || [])
      .map((field) => [field.name || field.id || '', field.value])
      .filter(([name, value]) => name && value != null && String(value).trim()),
  )
}

function getRespondTagNames(contact) {
  return (contact?.tags || [])
    .map((tag) => (typeof tag === 'string' ? tag : tag.name || tag.label || ''))
    .filter(Boolean)
}

function buildRespondContactSignalSummary({ customFields, tags, contact }) {
  const phone = extractRespondContactPhone(contact, customFields)

  return Object.fromEntries(
    Object.entries({
      leadStatus: customFields.lead_status,
      classification: customFields.classification,
      hasHubspotId: Boolean(customFields.hubspot_id),
      hasPhone: Boolean(phone),
      state: customFields.state || customFields.state1,
      treatment: customFields.treatment || customFields.desired_treatment_form,
      contactStatus: contact?.status,
      lifecycle: contact?.lifecycle,
      tags: tags.length ? tags.join(', ') : '',
    }).filter(([, value]) => Boolean(value)),
  )
}

function buildRespondContactBookingDetails({ contact, customFields }) {
  const phone = extractRespondContactPhone(contact, customFields)
  const contactName = extractRespondContactName(contact, customFields)

  return Object.fromEntries(
    Object.entries({
      firstName: contact?.firstName || contactName.firstName,
      lastName: contact?.lastName || contactName.lastName,
      phone,
      email: isPlaceholderEmail(contact?.email) ? '' : contact?.email,
      state: normalizeRespondState(customFields.state || customFields.state1),
      desiredTreatment: customFields.treatment || customFields.desired_treatment_form,
      preferredLanguage: normalizeRespondContactLanguage(contact?.language),
    }).filter(([, value]) => Boolean(value)),
  )
}

function extractRespondContactName(contact, customFields = {}) {
  const directName = [
    contact?.fullName,
    contact?.name,
    contact?.displayName,
    customFields.full_name,
    customFields.fullName,
    customFields.name,
    customFields.Name,
  ]
    .map((value) => String(value || '').trim())
    .find((value) => isLikelyCustomerName(value) && !extractPhoneNumber(value))

  return directName ? splitCustomerName(directName) : {}
}

function extractRespondContactPhone(contact, customFields = {}) {
  const directValue = [
    contact?.phone,
    contact?.phoneNumber,
    contact?.phone_number,
    contact?.identifier,
    contact?.contactIdentifier,
    contact?.name,
    customFields.phone,
    customFields.Phone,
    customFields.whatsapp,
    customFields.WhatsApp,
  ]
    .map((value) => String(value || '').trim())
    .find((value) => extractPhoneNumber(value))

  if (directValue) {
    return extractPhoneNumber(directValue)
  }

  const nestedValues = [
    ...(Array.isArray(contact?.channels) ? contact.channels : []),
    ...(Array.isArray(contact?.identifiers) ? contact.identifiers : []),
  ]
    .flatMap((item) => Object.values(item || {}))
    .map((value) => String(value || '').trim())
    .find((value) => extractPhoneNumber(value))

  return nestedValues ? extractPhoneNumber(nestedValues) : ''
}

function getRespondContactBookingDetails(profile) {
  return profile?.bookingDetails || {}
}

function getCustomerFirstName(details = {}, profile = {}) {
  return String(details.firstName || profile?.bookingDetails?.firstName || '')
    .split(/\s+/)[0]
    .trim()
}

function mergeRespondContactProfileFallbacks(profile, fallbacks = {}) {
  if (!fallbacks.phone || profile?.bookingDetails?.phone) {
    return profile
  }

  return {
    ...profile,
    bookingDetails: {
      ...(profile?.bookingDetails || {}),
      phone: fallbacks.phone,
    },
  }
}

function normalizeRespondState(value) {
  const state = extractStateName(String(value || ''))

  return state || String(value || '').split(/[-–]/)[0].trim()
}

function normalizeRespondContactLanguage(language) {
  const normalized = String(language || '').toLowerCase()

  if (normalized.startsWith('es')) {
    return 'Latin American Spanish'
  }

  if (normalized.startsWith('pt')) {
    return 'Portuguese'
  }

  if (normalized.startsWith('en')) {
    return 'English'
  }

  return ''
}

function isPlaceholderEmail(email) {
  return /@dummy\.com$/i.test(String(email || ''))
}

function formatRespondContactProfileForPrompt(profile) {
  const firstName = getCustomerFirstName(profile?.bookingDetails, profile)
  const fields = profile.fields
    ? Object.entries(profile.fields)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ')
    : ''

  return [
    'Respond contact profile context:',
    `Contact status identifier: ${profile.status} (${profile.label}).`,
    `Reason: ${profile.reason}`,
    firstName ? `Customer first name: ${firstName}. Use it naturally sometimes, especially in explanatory or out-of-flow replies, but do not repeat it in every message.` : '',
    fields ? `Current Respond signals: ${fields}` : '',
    'Use this only for routing and tone. Do not mention internal field names or IDs to the customer.',
  ]
    .filter(Boolean)
    .join('\n')
}

function formatBookingContextForPrompt(booking = {}) {
  const details = booking.details || {}
  const firstName = getCustomerFirstName(details)
  const offeredOption = booking.offeredOption
  const options = booking.options || []
  const lines = [
    'Current booking flow context:',
    firstName ? `Customer first name: ${firstName}.` : '',
    booking.pendingField ? `Pending field: ${booking.pendingField}.` : '',
    details.state ? `Known state: ${details.state}.` : '',
    details.desiredTreatment ? `Known desired treatment/goal: ${details.desiredTreatment}.` : '',
    details.phone ? 'Customer phone is already known from Respond/contact context.' : '',
    offeredOption
      ? `Already offered slot: ${formatCustomerStateSlot(
          offeredOption.startTime,
          details.state,
          offeredOption.timezone,
        )}.`
      : '',
    options.length
      ? `Already offered numbered slots:\n${formatNumberedSlots(options, details.state)}`
      : '',
    'If the latest customer message asks an information question, answer it from company knowledge first. Then briefly return to the current booking flow without asking for details already known or inventing availability.',
  ].filter(Boolean)

  return lines.join('\n')
}

function getBookingTeamForRespondContact(profile) {
  return profile?.status && profile.status !== 'new_or_no_record' ? 'customer_service' : 'sales'
}

async function handleRespondBookingAutomation({
  session,
  messages,
  customerLanguage,
  respondContactProfile,
}) {
  const existingBooking = session.booking || {}
  const bookingTeam = existingBooking.bookingTeam || getBookingTeamForRespondContact(respondContactProfile)
  const latestUserText = [...messages].reverse().find((item) => item.role === 'user')?.content || ''
  const latestSignals = extractRespondBookingDetailsFromText(latestUserText)
  let details = {
    ...getRespondContactBookingDetails(respondContactProfile),
    ...(existingBooking.details || {}),
    ...extractRespondBookingDetails(messages),
    ...latestSignals,
  }
  details = withDefaultRespondDesiredTreatment(details)

  if (existingBooking.pendingField === 'state') {
    const state = latestSignals.state || details.state

    if (!state) {
      const text = isGreetingOnly(latestUserText)
        ? `${acknowledgeGreeting(customerLanguage)} ${bookingCopy(customerLanguage, 'askState')}`
        : bookingCopy(customerLanguage, 'askState')

      return {
        text,
        booking: { ...existingBooking, bookingTeam, details, pendingField: 'state' },
      }
    }

    const nextDetails = withDefaultRespondDesiredTreatment({ ...details, state })

    if (shouldUseOutOfStatePrescribedTemplate(nextDetails)) {
      return {
        text: shouldUseRepeatOutOfStateTemplate(existingBooking, nextDetails)
          ? outOfStatePrescribedRepeatTemplate(customerLanguage)
          : outOfStatePrescribedTemplate(customerLanguage),
        booking: {
          ...existingBooking,
          bookingTeam,
          details: nextDetails,
          pendingField: 'state',
          outOfStateNotified: true,
        },
      }
    }

    if (!nextDetails.phone) {
      return {
        text: bookingCopy(customerLanguage, 'askPhone'),
        booking: { ...existingBooking, bookingTeam, details: nextDetails, pendingField: '' },
      }
    }

    return await offerSoonestRespondSlot({
      booking: { ...existingBooking, bookingTeam, pendingField: '' },
      details: nextDetails,
      customerLanguage,
    })
  }

  if (existingBooking.pendingField === 'goals') {
    const nextDetails = withDefaultRespondDesiredTreatment(details)

    if (isOutOfFlowInfoQuestion(latestUserText)) {
      existingBooking.details = nextDetails
      return null
    }

    if (shouldUseOutOfStatePrescribedTemplate(nextDetails)) {
      return {
        text: shouldUseRepeatOutOfStateTemplate(existingBooking, nextDetails)
          ? outOfStatePrescribedRepeatTemplate(customerLanguage)
          : outOfStatePrescribedTemplate(customerLanguage),
        booking: {
          ...existingBooking,
          bookingTeam,
          details: nextDetails,
          pendingField: 'state',
          outOfStateNotified: true,
        },
      }
    }

    if (!nextDetails.phone) {
      return {
        text: bookingCopy(customerLanguage, 'askPhone'),
        booking: { ...existingBooking, bookingTeam, details: nextDetails, pendingField: '' },
      }
    }

    return await offerSoonestRespondSlot({
      booking: { ...existingBooking, bookingTeam, pendingField: '' },
      details: nextDetails,
      customerLanguage,
    })
  }

  if (existingBooking.pendingField === 'preferredTime') {
    const preferredTime = extractPreferredTimeText(latestUserText) || latestUserText.trim()
    const nextDetails = { ...details, preferredTime }

    return await offerSoonestRespondSlot({
      booking: { ...existingBooking, bookingTeam, offeredOption: null, options: [] },
      details: nextDetails,
      customerLanguage,
      preferredTime,
      closest: true,
    })
  }

  if (existingBooking.pendingField === 'name') {
    const nameDetails = splitCustomerName(latestUserText)
    const nextDetails = mergeNonEmptyDetails(details, nameDetails)

    if (!nextDetails.firstName || !nextDetails.lastName) {
      return {
        text: bookingCopy(customerLanguage, 'askName'),
        booking: { ...existingBooking, bookingTeam, details: nextDetails, pendingField: 'name' },
      }
    }

    return await bookAcceptedRespondSlot({
      booking: { ...existingBooking, bookingTeam },
      details: nextDetails,
      customerLanguage,
    }).catch((error) =>
      buildRespondBookingFailure({ ...existingBooking, bookingTeam }, nextDetails, customerLanguage, error),
    )
  }

  const selectedOption = pickRespondAvailabilityOption(latestUserText, existingBooking.options)
  const hasActiveSlotOffer = Boolean(existingBooking.offeredOption || existingBooking.options?.length)

  if (
    !isActiveBookingContinuation(existingBooking, latestUserText) &&
    !isBookingFlowSignal(latestUserText) &&
    !latestSignals.state &&
    !latestSignals.desiredTreatment &&
    !latestSignals.preferredTime
  ) {
    return null
  }

  if (hasActiveSlotOffer && !selectedOption && isOutOfFlowInfoQuestion(latestUserText)) {
    return null
  }

  if (hasActiveSlotOffer && latestSignals.preferredTime) {
    const nextDetails = { ...details, ...latestSignals }

    return await offerSoonestRespondSlot({
      booking: { ...existingBooking, bookingTeam, offeredOption: null, options: [] },
      details: nextDetails,
      customerLanguage,
      preferredTime: latestSignals.preferredTime,
      closest: true,
    })
  }

  // When the user rejects a single offered slot, offer more alternatives instead of asking for preferred time
  if (existingBooking.offeredOption && isNegativeReply(latestUserText)) {
    const preferredTime = extractPreferredTimeText(latestUserText) || details.preferredTime
    const nextDetails = preferredTime ? { ...details, preferredTime } : details

    return await offerSoonestRespondSlot({
      booking: { ...existingBooking, bookingTeam, offeredOption: null, options: [] },
      details: nextDetails,
      customerLanguage,
      preferredTime,
      closest: true,
    })
  }

  // When user rejects from a list, offer a fresh set of alternatives
  if (existingBooking.options?.length > 1 && isNegativeReply(latestUserText)) {
    const preferredTime = extractPreferredTimeText(latestUserText) || details.preferredTime
    const nextDetails = preferredTime ? { ...details, preferredTime } : details

    return await offerSoonestRespondSlot({
      booking: { ...existingBooking, bookingTeam, offeredOption: null, options: [] },
      details: nextDetails,
      customerLanguage,
      preferredTime,
      closest: true,
    })
  }

  if (existingBooking.options?.length > 1 && !selectedOption) {
    return {
      text: bookingCopy(customerLanguage, 'askChooseOption'),
      booking: existingBooking,
    }
  }

  // When user confirms a slot (selected one or said yes to offered one), ask for their name
  if (selectedOption || (existingBooking.offeredOption && isAffirmative(latestUserText))) {
    const option = selectedOption || existingBooking.offeredOption

    if (!details.firstName || !details.lastName) {
      return {
        text: bookingCopy(customerLanguage, 'askName'),
        booking: {
          ...existingBooking,
          bookingTeam,
          details,
          offeredOption: option,
          pendingField: 'name',
        },
      }
    }

    return await bookAcceptedRespondSlot({
      booking: { ...existingBooking, bookingTeam, offeredOption: option },
      details,
      customerLanguage,
    }).catch((error) =>
      buildRespondBookingFailure(
        { ...existingBooking, bookingTeam, offeredOption: option },
        details,
        customerLanguage,
        error,
      ),
    )
  }

  const hasBookingSignal =
    existingBooking.offeredOption ||
    existingBooking.pendingField ||
    isBookingRequest(latestUserText) ||
    isBookingFlowSignal(latestUserText) ||
    Boolean(latestSignals.state || latestSignals.desiredTreatment || latestSignals.preferredTime) ||
    Boolean(details.state && details.desiredTreatment)

  if (!hasBookingSignal) {
    return null
  }

  if (shouldUseOutOfStatePrescribedTemplate(details)) {
    return {
      text: shouldUseRepeatOutOfStateTemplate(existingBooking, details)
        ? outOfStatePrescribedRepeatTemplate(customerLanguage)
        : outOfStatePrescribedTemplate(customerLanguage),
      booking: {
        ...existingBooking,
        bookingTeam,
        details,
        pendingField: 'state',
        outOfStateNotified: true,
      },
    }
  }

  if (!details.state) {
    return {
      text: bookingCopy(customerLanguage, 'askState'),
      booking: { ...existingBooking, bookingTeam, details, pendingField: 'state' },
    }
  }

  if (!details.phone) {
    return {
      text: bookingCopy(customerLanguage, 'askPhone'),
      booking: { ...existingBooking, bookingTeam, details },
    }
  }

  if (existingBooking.offeredOption && !isNegativeReply(latestUserText)) {
    return null
  }

  // Offer the first available slot immediately — do not ask for preferred time
  return await offerSoonestRespondSlot({
    booking: { ...existingBooking, bookingTeam },
    details,
    customerLanguage,
    preferredTime: latestSignals.preferredTime || details.preferredTime,
  })
}

async function offerSoonestRespondSlot({
  booking,
  details,
  customerLanguage,
  preferredTime = details.preferredTime,
  closest = false,
}) {
  const getAvailability =
    booking.bookingTeam === 'customer_service'
      ? getCustomerServiceAvailability
      : getPrioritySellerAvailability
  const hasTimeConstraint = hasAvailabilityTimeConstraint(details)
  const options = await getAvailability({
    limit: closest || hasTimeConstraint ? 24 : 1,
    preferredTime,
  })
  const fallbackOptions =
    closest && options.length === 0
      ? await getAvailability({ limit: 24 })
      : []
  let availableOptions = filterOptionsByAvailabilityPreference(
    options.length ? options : fallbackOptions,
    details,
  )

  if (hasTimeConstraint && availableOptions.length === 0) {
    availableOptions = filterOptionsByAvailabilityPreference(
      await getAvailability({ limit: 24 }),
      details,
    )
  }
  const offeredOption = availableOptions[0]

  if (!offeredOption) {
    return {
      text: bookingCopy(customerLanguage, 'noAvailability'),
      booking: { ...booking, details },
    }
  }

  const nextOptions = closest
    ? selectBalancedAvailabilityOptions(availableOptions, details.state)
    : [offeredOption]

  return {
    text: closest
      ? bookingCopy(customerLanguage, options.length ? 'offerClosestSlots' : 'offerFallbackSlots', {
          slots: formatNumberedSlots(nextOptions, details.state),
        })
      : bookingCopy(customerLanguage, 'offerSlot', {
          slot: formatCustomerStateSlot(offeredOption.startTime, details.state, offeredOption.timezone),
        }),
    booking: {
      details,
      bookingTeam: booking.bookingTeam || 'sales',
      options: nextOptions,
      offeredOption: closest ? null : offeredOption,
      pendingField: '',
    },
  }
}

function hasAvailabilityTimeConstraint(details = {}) {
  return Number.isInteger(details.earliestHour)
}

function filterOptionsByAvailabilityPreference(options = [], details = {}) {
  if (!hasAvailabilityTimeConstraint(details)) {
    return options
  }

  return options.filter((option) => {
    const localHour = getCustomerStateHour(option.startTime, details.state, option.timezone)

    return localHour != null && localHour >= details.earliestHour
  })
}

function selectBalancedAvailabilityOptions(options = [], state = '') {
  const sortedOptions = [...options].sort((left, right) => left.startTime - right.startTime)
  const morningOptions = sortedOptions.filter((option) => {
    const localHour = getCustomerStateHour(option.startTime, state, option.timezone)

    return localHour != null && localHour < 12
  })
  const afternoonOptions = sortedOptions.filter((option) => {
    const localHour = getCustomerStateHour(option.startTime, state, option.timezone)

    return localHour != null && localHour >= 12
  })

  if (morningOptions.length && afternoonOptions.length) {
    const perDayPart = morningOptions.length >= 3 && afternoonOptions.length >= 3 ? 3 : 2
    const balanced = [
      ...morningOptions.slice(0, perDayPart),
      ...afternoonOptions.slice(0, perDayPart),
    ].sort((left, right) => left.startTime - right.startTime)

    if (balanced.length >= 4 || sortedOptions.length <= balanced.length) {
      return balanced
    }

    const selected = new Set(balanced)
    const fill = sortedOptions.filter((option) => !selected.has(option)).slice(0, 4 - balanced.length)

    return [...balanced, ...fill].sort((left, right) => left.startTime - right.startTime)
  }

  return sortedOptions.slice(0, Math.min(4, sortedOptions.length))
}

async function bookAcceptedRespondSlot({ booking, details, customerLanguage }) {
  const option = booking.offeredOption || booking.options?.[0]

  if (!option) {
    return {
      text: bookingCopy(customerLanguage, 'checking'),
      booking: { ...booking, details },
    }
  }

  const bookMeeting =
    booking.bookingTeam === 'customer_service'
      ? bookCustomerServiceMeeting
      : bookPrioritySellerMeeting
  const customer = buildRespondBookingCustomer(details, customerLanguage)
  const booked = await bookMeeting({
    customer,
    option,
  })

  return {
    text: buildBookedMessage({
      bookingTeam: booking.bookingTeam,
      option,
      booked,
      customer,
    }),
    booking: null,
  }
}

function buildRespondBookingFailure(booking, details, customerLanguage, error) {
  console.warn(`Unable to book Respond HubSpot appointment: ${error.message}`)

  return {
    text: bookingCopy(customerLanguage, 'bookingFailed'),
    booking: { ...booking, details },
  }
}

function shouldUseOutOfStatePrescribedTemplate(details) {
  return Boolean(
    details.state &&
      !isPrescribedTreatmentDeliveryState(details.state) &&
      !isAlternativeTreatment(details.desiredTreatment),
  )
}

function shouldUseRepeatOutOfStateTemplate(booking, details) {
  return Boolean(
    booking?.outOfStateNotified &&
      normalizeSearchText(booking.details?.state) === normalizeSearchText(details.state),
  )
}

function isAlternativeTreatment(treatment) {
  return /\b(nutrition|supplements?|suplementos?)\b/i.test(String(treatment || ''))
}

const DEFAULT_RESPOND_DESIRED_TREATMENT = 'Weight Loss Injections'

function withDefaultRespondDesiredTreatment(details) {
  return {
    ...details,
    desiredTreatment: details.desiredTreatment || DEFAULT_RESPOND_DESIRED_TREATMENT,
  }
}

function outOfStatePrescribedTemplate(language, firstName = '') {
  const langNorm = normalizeLanguageName(language)
  const namePrefix = firstName ? `${firstName}, ` : ''
  const named = (withName, withoutName) => (firstName ? `${namePrefix}${withName}` : withoutName)

  if (langNorm === 'Latin American Spanish') {
    return [
      `💛✨ ${named('por el momento no podemos enviar inyecciones de pérdida de peso a su estado😔.', 'Por el momento no podemos enviar inyecciones de pérdida de peso a su estado😔.')}`,
      'Pero sí podemos ayudarte con nuestra línea de suplementos Dharma, diseñados para apoyar tu proceso de forma natural:',
      '🔥 *Fat Burner*: acelera el metabolismo, da energía limpia y ayuda a quemar grasa durante el día.',
      '🟠 *Berberine*: controla antojos, reduce azúcar en sangre y baja la inflamación abdominal.',
      '💪 *Creatine*: mejora fuerza, tonifica más rápido y acelera la recuperación para verte más fit.',
      '*Puedes ver todo aquí* 👉 [https://dharmanutritionclinic.com/collections/supplements](https://dharmanutritionclinic.com/collections/supplements)',
    ].join('\n')
  }

  if (langNorm === 'Portuguese') {
    return [
      `💛✨ ${named('no momento, não podemos enviar injeções de perda de peso para o seu estado😔.', 'No momento, não podemos enviar injeções de perda de peso para o seu estado😔.')}`,
      'Mas podemos ajudar você com nossa linha de suplementos Dharma, desenvolvida para apoiar seu processo de forma natural:',
      '🔥 *Fat Burner*: acelera o metabolismo, dá energia limpa e ajuda a queimar gordura durante o dia.',
      '🟠 *Berberine*: controla desejos, reduz o açúcar no sangue e diminui a inflamação abdominal.',
      '💪 *Creatine*: melhora a força, tonifica mais rápido e acelera a recuperação para você ficar mais fit.',
      '*Você pode ver tudo aqui* 👉 [https://dharmanutritionclinic.com/collections/supplements](https://dharmanutritionclinic.com/collections/supplements)',
    ].join('\n')
  }

  return [
    `💛✨ ${named('at the moment, we cannot ship weight loss injections to your state😔.', 'At the moment, we cannot ship weight loss injections to your state😔.')}`,
    'But we can help you with our Dharma supplement line, designed to support your journey naturally:',
    '🔥 *Fat Burner*: speeds up metabolism, provides clean energy, and helps burn fat throughout the day.',
    '🟠 *Berberine*: controls cravings, reduces blood sugar, and lowers abdominal inflammation.',
    '💪 *Creatine*: improves strength, tones faster, and speeds up recovery so you look more fit.',
    '*You can view everything here* 👉 [https://dharmanutritionclinic.com/collections/supplements](https://dharmanutritionclinic.com/collections/supplements)',
  ].join('\n')
}

function outOfStatePrescribedRepeatTemplate(language, firstName = '') {
  const langNorm = normalizeLanguageName(language)
  const namePrefix = firstName ? `${firstName}, ` : ''

  if (langNorm === 'Latin American Spanish') {
    return `${namePrefix}si, para inyecciones de perdida de peso todavia no podemos enviar a ese estado. Podemos ayudarte con suplementos Dharma o guia nutricional si quieres seguir por esa opcion.`
  }

  if (langNorm === 'Portuguese') {
    return `${namePrefix}sim, para injeções de perda de peso ainda não conseguimos enviar para esse estado. Podemos ajudar com suplementos Dharma ou orientação nutricional se quiser seguir por essa opção.`
  }

  return `${namePrefix}Yes, for weight loss injections we still cannot ship to that location. We can help with Dharma supplements or nutrition guidance if you would like to continue that way.`
}

function extractRespondBookingDetails(messages) {
  const userMessages = messages.filter((item) => item.role === 'user').map((item) => item.content || '')
  const joined = userMessages.join('\n')
  const latestState = [...userMessages].reverse().map(extractStateName).find(Boolean)
  const latestTreatment = [...userMessages].reverse().map(extractDesiredTreatmentName).find(Boolean)
  const latestPreferredTime = [...userMessages].reverse().map(extractPreferredTimeText).find(Boolean)
  const latestAvailabilityPreference = [...userMessages]
    .reverse()
    .map(extractAvailabilityPreference)
    .find((preference) => preference.hasPreference)

  return Object.fromEntries(
    Object.entries({
      state: latestState,
      desiredTreatment: latestTreatment,
      preferredTime: latestAvailabilityPreference?.preferredTime || latestPreferredTime,
      earliestHour: latestAvailabilityPreference?.earliestHour,
      dayPart: latestAvailabilityPreference?.dayPart,
      phone: extractPhoneNumber(joined),
    }).filter(([, value]) => Boolean(value)),
  )
}

function extractRespondBookingDetailsFromText(content) {
  const availabilityPreference = extractAvailabilityPreference(content)

  return Object.fromEntries(
    Object.entries({
      state: extractStateName(content),
      desiredTreatment: extractDesiredTreatmentName(content),
      preferredTime: availabilityPreference.preferredTime || extractPreferredTimeText(content),
      earliestHour: availabilityPreference.earliestHour,
      dayPart: availabilityPreference.dayPart,
      phone: extractPhoneNumber(content),
    }).filter(([, value]) => Boolean(value)),
  )
}

function buildRespondBookingCustomer(details, customerLanguage) {
  const bookingDetails = withDefaultRespondDesiredTreatment(details)

  return {
    firstName: bookingDetails.firstName || 'New',
    lastName: bookingDetails.lastName || 'Lead',
    email: createDummyEmailFromPhone(bookingDetails.phone),
    phone: bookingDetails.phone,
    preferredLanguage: customerLanguage,
    desiredTreatment: bookingDetails.desiredTreatment,
    state: bookingDetails.state,
  }
}

function bookingCopy(language, key, values = {}) {
  const langNorm = normalizeLanguageName(language)
  const spanish = langNorm === 'Latin American Spanish'
  const portuguese = langNorm === 'Portuguese'
  const firstName = String(values.firstName || '').trim()
  const nameLead = firstName ? `${firstName}, ` : ''
  const named = (withName, withoutName) => (firstName ? `${nameLead}${withName}` : withoutName)

  function tri(en, es, pt) {
    if (spanish) return es
    if (portuguese) return pt
    return en
  }

  const copy = {
    askState: tri(
      '📍Please tell us which state you live in to find out if we ship to your state?',
      '📍Dime por favor en que estado vives para saber si hacemos envios a su Estado?',
      '📍Por favor, me informe em que estado você mora para saber se fazemos entregas para o seu Estado?',
    ),
    askPhone: tri(
      'Perfect. To check the available slot and move forward, please send the best phone number for the call.',
      'Perfecto. Para revisar el horario disponible y avanzar con la cita, enviame por favor el mejor numero de telefono para la llamada.',
      'Perfeito. Para verificar o horário disponível e avançar com o agendamento, por favor me envie o melhor número de telefone para a chamada.',
    ),
    askName: tri(
      'That time works. What full name should I put on the appointment?',
      'Ese horario funciona. Que nombre completo pongo para la cita?',
      'Esse horário funciona. Qual nome completo devo colocar no agendamento?',
    ),
    askNameBeforeSlot: tri(
      'Perfect, I have your number. What full name should I use to check and book the appointment?',
      'Perfecto, ya tengo tu numero. Que nombre completo pongo para revisar y agendar la cita?',
      'Perfeito, já tenho seu número. Qual nome completo devo usar para verificar e agendar a consulta?',
    ),
    offerSlot: tri(
      `📅 ${named('I have this available time for your free discovery call:', 'I have this available time for your free discovery call:')} ${values.slot}. Does that work for you?`,
      `${named('tengo este horario disponible para tu llamada gratuita de análisis:', 'Tengo este horario disponible para tu llamada gratuita de análisis:')} ${values.slot}. Te funciona?`,
      `${named('tenho este horário disponível para sua chamada gratuita de análise:', 'Tenho este horário disponível para sua chamada gratuita de análise:')} ${values.slot}. Funciona para você?`,
    ),
    askPreferredTime: tri(
      'Of course, no problem. What day and time works best for the call?',
      'Claro, no hay problema. Que dia y hora te queda mejor para la llamada?',
      'Claro, sem problema. Que dia e hora funciona melhor para você?',
    ),
    offerClosestSlot: tri(
      `I do not see that exact time, but this is the closest available opening: ${values.slot}. Does that work for you?`,
      `No veo exactamente ese horario, pero este es el espacio mas cercano disponible: ${values.slot}. Te funciona?`,
      `Não vejo exatamente esse horário, mas este é o espaço mais próximo disponível: ${values.slot}. Funciona para você?`,
    ),
    offerClosestSlots: tri(
      `📅 ${named('I do not have that exact time available, but these are the closest schedules based on your desired time:', 'I do not have that exact time available, but these are the closest schedules based on your desired time:')}\n${values.slots}\n\nWhich option works best? Please reply with the number.`,
      `${named('no tengo ese horario exacto disponible, pero estos son los horarios mas cercanos segun tu preferencia:', 'No tengo ese horario exacto disponible, pero estos son los horarios mas cercanos segun tu preferencia:')}\n${values.slots}\n\nCual opcion te funciona mejor? Responde con el numero.`,
      `${named('não tenho exatamente esse horário disponível, mas estes são os horários mais próximos conforme sua preferência:', 'Não tenho exatamente esse horário disponível, mas estes são os horários mais próximos conforme sua preferência:')}\n${values.slots}\n\nQual opção funciona melhor? Responda com o número.`,
    ),
    offerAlternativeSlots: tri(
      `That time does not work. Here are the next available openings:\n${values.slots}\n\nWhich option works best? Please reply with the number.`,
      `Ese horario no funciona. Estos son los proximos espacios disponibles:\n${values.slots}\n\nCual opcion te funciona mejor? Responde con el numero.`,
      `Esse horário não funciona. Estes são os próximos horários disponíveis:\n${values.slots}\n\nQual opção funciona melhor? Responda com o número.`,
    ),
    offerFallbackSlots: tri(
      `📅 ${named('I do not have availability for that requested time right now, but these are the next available openings:', 'I do not have availability for that requested time right now, but these are the next available openings:')}\n${values.slots}\n\nWhich option works best? Please reply with the number.`,
      `${named('no tengo disponibilidad para ese horario en este momento, pero estos son los proximos espacios disponibles:', 'No tengo disponibilidad para ese horario en este momento, pero estos son los proximos espacios disponibles:')}\n${values.slots}\n\nCual opcion te funciona mejor? Responde con el numero.`,
      `${named('não tenho disponibilidade para esse horário agora, mas estes são os próximos horários disponíveis:', 'Não tenho disponibilidade para esse horário agora, mas estes são os próximos horários disponíveis:')}\n${values.slots}\n\nQual opção funciona melhor? Responda com o número.`,
    ),
    askChooseOption: tri(
      'Which option works best? Please reply with the number so I can book it.',
      'Cual opcion te funciona mejor? Responde con el numero para agendarla.',
      'Qual opção funciona melhor? Responda com o número para que eu possa agendar.',
    ),
    booked: tri(
      `All set, your call is booked for ${values.slot}. The appointment details will be sent to you.`,
      `Listo, tu llamada quedo agendada para ${values.slot}. Te enviaran los detalles de la cita.`,
      `Pronto, sua chamada está agendada para ${values.slot}. Os detalhes do agendamento serão enviados para você.`,
    ),
    noAvailability: tri(
      'I do not see available slots right now. I will route this to the team so they can help find the next opening.',
      'No veo horarios disponibles en este momento. Voy a pasarlo al equipo para que te ayuden a encontrar el proximo espacio.',
      'Não vejo horários disponíveis no momento. Vou encaminhar para a equipe para que possam ajudá-lo a encontrar o próximo espaço disponível.',
    ),
    bookingFailed: tri(
      'I could not confirm that appointment right now. I will route this to the team so they can check the calendar and help schedule it.',
      'No pude confirmar esa cita en este momento. Voy a pasarlo al equipo para que revisen el calendario y te ayuden a agendar.',
      'Não consegui confirmar esse agendamento agora. Vou encaminhar para a equipe para que verifiquem o calendário e ajudem a agendar.',
    ),
    checking: tri(
      'Give me a moment and I will help with the next available time.',
      'Dame un momento y te ayudo con el proximo horario disponible.',
      'Dê-me um momento e vou ajudá-lo com o próximo horário disponível.',
    ),
  }

  return copy[key] || ''
}


function formatNumberedSlots(options = [], state = '') {
  return options
    .map((option, index) => {
      const specialistName = option.sellerName ? `Specialist ${option.sellerName} - ` : ''

      return `${index + 1}. ${specialistName}${formatCustomerStateSlot(
        option.startTime,
        state,
        option.timezone,
      )}`
    })
    .join('\n')
}

function pickRespondAvailabilityOption(content, options = []) {
  if (extractAvailabilityPreference(content).hasPreference || extractPreferredTimeText(content)) {
    return null
  }

  const normalized = normalizeSearchText(content)
  const selectedId =
    normalized.match(/^(?:option|number|slot|opcion|opción|numero|número|la|el)?\s*(\d{1,2})$/)?.[1] ||
    normalized.match(/\b(?:option|number|slot|opcion|opción|numero|número|la|el)\s+(\d{1,2})\b/)?.[1]

  return options.find((option) => option.id === selectedId) || null
}

function isActiveBookingContinuation(booking, latestUserText) {
  if (booking.pendingField) {
    return true
  }

  if (booking.options?.length > 0 || booking.offeredOption) {
    return (
      pickRespondAvailabilityOption(latestUserText, booking.options) ||
      isAffirmative(latestUserText) ||
      isNegativeReply(latestUserText) ||
      extractPreferredTimeText(latestUserText) ||
      isBookingRequest(latestUserText)
    )
  }

  return isBookingRequest(latestUserText)
}

function isGreetingOnly(content) {
  const normalized = normalizeSearchText(content)

  return /^(hi|hello|hey|hola|buenas|buenos dias|buenas tardes|buenas noches|ola|oi)$/.test(normalized)
}

function acknowledgeGreeting(language) {
  const langNorm = normalizeLanguageName(language)

  if (langNorm === 'Latin American Spanish') {
    return 'Hola, con gusto. ✨'
  }

  if (langNorm === 'Portuguese') {
    return 'Olá, com prazer. ✨'
  }

  return 'Hello, happy to help. ✨'
}

function isAffirmative(content) {
  const normalized = normalizeSearchText(content)

  if (/[?]/.test(String(content || '')) || /\b(when|what time|which|cuando|que hora)\b/.test(normalized)) {
    return false
  }

  return /\b(yes|yeah|yep|ok|okay|sure|works|perfect|confirm|book it|si|claro|dale|esta bien)\b/i.test(
    content,
  )
}


function isNegative(content) {
  return /\b(no|not|doesn'?t work|otro|otra|different|later|mas tarde|m[aá]s tarde)\b/i.test(content)
}

function isNegativeReply(content) {
  const normalized = normalizeSearchText(content)

  if (isOutOfFlowInfoQuestion(content)) {
    return false
  }

  if (extractAvailabilityPreference(content).hasPreference) {
    return false
  }

  return (
    /\b(no|nope|nah|not|doesn t work|doesnt work|otro|otra|different|later|mas tarde)\b/i.test(
      normalized,
    ) || isNegative(content)
  )
}

function isOutOfFlowInfoQuestion(content) {
  const normalized = normalizeSearchText(content)

  if (!normalized) {
    return false
  }

  return [
    /\b(what|whats|what is|tell me|explain|learn more|more about|about your|about the|how does|how do|how it works|what happens|what includes|included|difference|safe|side effect|side effects|price|cost|payment|company|clinic|program|treatment|medication|medicine|injection|semaglutide|tirzepatide|zepbound|glp 1|supplement|nutrition|peptide)\b/.test(normalized),
    /\b(que es|de que|explica|explicame|quiero saber|mas informacion|mas sobre|como funciona|que incluye|incluye|diferencia|seguro|efectos secundarios|precio|cuanto|costo|pago|compania|clinica|programa|tratamiento|medicamento|inyeccion|suplemento|nutricion|peptido)\b/.test(normalized),
    /\b(o que e|explique|quero saber|mais informacao|mais sobre|como funciona|o que inclui|inclui|diferenca|seguro|efeitos colaterais|preco|quanto custa|custo|pagamento|empresa|clinica|programa|tratamento|medicamento|injecao|suplemento|nutricao|peptideo)\b/.test(normalized),
  ].some(Boolean)
}

function extractAvailabilityPreference(content) {
  const normalized = normalizeSearchText(content)

  if (!normalized) {
    return { hasPreference: false }
  }

  const afterHourPatterns = [
    /\b(?:after|later than|from)\s+(?:las\s+)?(\d{1,2})(?::\d{2})?\s*(am|pm)?\b/,
    /\b(?:despues de|despues de las|a partir de|a partir de las|mas tarde de|mas tarde de las|despues)\s+(\d{1,2})(?::\d{2})?\s*(am|pm)?\b/,
    /\b(?:después de|después de las|más tarde de|más tarde de las)\s+(\d{1,2})(?::\d{2})?\s*(am|pm)?\b/i,
  ]

  for (const pattern of afterHourPatterns) {
    const match = String(content || '').match(pattern)

    if (match) {
      const earliestHour = normalizeAvailabilityHour(Number(match[1]), match[2])

      if (earliestHour != null) {
        return {
          hasPreference: true,
          preferredTime: `after ${formatPreferenceHour(earliestHour)}`,
          earliestHour,
          dayPart: earliestHour >= 12 ? 'afternoon' : 'morning',
        }
      }
    }
  }

  if (
    /\b(afternoon only|only afternoon|in the afternoon|not morning|no morning|later because i work|later because of work)\b/.test(
      normalized,
    ) ||
    /\b(solo en la tarde|por la tarde|en la tarde|no en la manana|no en la mañana|mas tarde porque trabajo|más tarde porque trabajo|tarde porque trabajo)\b/.test(
      normalized,
    )
  ) {
    return {
      hasPreference: true,
      preferredTime: 'afternoon',
      earliestHour: 12,
      dayPart: 'afternoon',
    }
  }

  if (/\b(evening only|in the evening|evening|noche|en la noche|por la noche)\b/.test(normalized)) {
    return {
      hasPreference: true,
      preferredTime: 'evening',
      earliestHour: 17,
      dayPart: 'evening',
    }
  }

  return { hasPreference: false }
}

function normalizeAvailabilityHour(hour, period = '') {
  if (!Number.isInteger(hour) || hour < 1 || hour > 12) {
    return null
  }

  const normalizedPeriod = String(period || '').toLowerCase()

  if (normalizedPeriod === 'am') {
    return hour === 12 ? 0 : hour
  }

  if (normalizedPeriod === 'pm') {
    return hour === 12 ? 12 : hour + 12
  }

  return hour >= 1 && hour <= 7 ? hour + 12 : hour
}

function formatPreferenceHour(hour) {
  const normalizedHour = Number(hour)
  const period = normalizedHour >= 12 ? 'pm' : 'am'
  const displayHour = normalizedHour % 12 || 12

  return `${displayHour}${period}`
}

function isBookingRequest(content) {
  const normalized = normalizeSearchText(content)

  return /\b(appointment|appointments|book|booking|schedule|scheduled|scheduling|availability|available|slot|slots|calendar|discovery call|call|meeting|today|tomorrow|cita|citas|agendar|agenda|agendame|horario|horarios|disponible|disponibilidad|consulta|llamada|reunion|marcar|marcame)\b/i.test(
    normalized,
  )
}

function isBookingFlowSignal(content) {
  const normalized = normalizeSearchText(content)

  return [
    extractStateName(content),
    extractDesiredTreatmentName(content),
    extractPreferredTimeText(content),
    /\b(weight loss|lose weight|losing weight|bajar de peso|perder peso|semaglutide|tirzepatide|zepbound|glp 1|injection|injections|supplements|nutrition|peptide|peptides)\b/.test(normalized),
    /\b(today|tomorrow|morning|afternoon|evening|am|pm|july|jul|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(normalized),
  ].some(Boolean)
}

function splitCustomerName(content) {
  const cleaned = cleanLikelyName(content)
  if (!isLikelyCustomerName(cleaned)) {
    return {}
  }
  const parts = cleaned.split(/\s+/).filter(Boolean)

  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
  }
}

function mergeNonEmptyDetails(currentDetails, nextDetails) {
  return Object.fromEntries(
    Object.entries({
      ...currentDetails,
      ...Object.fromEntries(
        Object.entries(nextDetails || {}).filter(([, value]) => Boolean(value)),
      ),
    }).filter(([, value]) => Boolean(value)),
  )
}

function isLikelyCustomerName(content) {
  const trimmed = String(content || '').trim()
  const normalized = normalizeSearchText(trimmed)
  const parts = trimmed.split(/\s+/).filter(Boolean)
  const nonNamePhrases = [
    /\bporque\b/,
    /\bpor que\b/,
    /\bbecause\b/,
    /\btrabajo\b/,
    /\bwork\b/,
    /\bi work\b/,
    /\bmy work\b/,
    /\bno puedo\b/,
    /\bi can t\b/,
    /\bi cannot\b/,
  ]

  // Support accented Latin characters (Spanish, Portuguese names)
  if (!/^[\p{L}][\p{L}' -]+$/u.test(trimmed) || parts.length < 2 || parts.length > 4) {
    return false
  }

  if (nonNamePhrases.some((pattern) => pattern.test(normalized))) {
    return false
  }

  if (isAffirmative(trimmed) || isNegativeReply(trimmed) || isBookingRequest(trimmed)) {
    return false
  }

  if (isGoalOrTreatmentStatement(normalized)) {
    return false
  }

  return !/\b(yes|yeah|yep|ok|okay|sure|works|does|good|fine|perfect|confirm|book|appointment|call|time|slot|tomorrow|today|morning|afternoon|evening|quiero|cita|si|claro|pero|solo|hablo|espanol|ingles|portuguese|portugues)\b/.test(
    normalized,
  )
}

function isGoalOrTreatmentStatement(normalizedContent) {
  return /\b(i|i m|im|me|my|wanna|want|need|goal|goals|lose|losing|weight|fat|bajar|perder|peso|nutrition|nutricion|supplement|supplements|suplemento|suplementos|peptide|peptides|peptido|peptidos|injection|injections|shot|shots|semaglutide|tirzepatide|zepbound)\b/.test(
    normalizedContent,
  )
}

function shouldRestartRespondConversation(session) {
  return (
    session.messages.length === 0 ||
    (SESSION_RESTART_WINDOW_MS > 0 &&
      session.lastInteractionAt > 0 &&
      Date.now() - session.lastInteractionAt >= SESSION_RESTART_WINDOW_MS)
  )
}

async function sendInitialRespondSequence({ contactId, channelId, customerLanguage, firstName = '' }) {
  const greeting = getInitialGreeting(customerLanguage, firstName)
  const stateQuestion = getInitialStateQuestion(customerLanguage)

  if (INITIAL_IMAGE_URL) {
    await sendRespondImageMessage({
      contactId,
      channelId,
      imageUrl: INITIAL_IMAGE_URL,
    }).catch((error) => {
      console.warn(`Unable to send initial Respond image: ${error.message}`)
    })
  }

  await sendRespondTextMessage({ contactId, channelId, text: greeting })
  await sendRespondTextMessage({ contactId, channelId, text: stateQuestion })
}

function getInitialGreeting(customerLanguage, firstName = '') {
  const greeting =
    INITIAL_GREETING_BY_LANGUAGE[normalizeLanguageName(customerLanguage)] ||
    INITIAL_GREETING_BY_LANGUAGE.English

  if (!firstName) {
    return greeting
  }

  const langNorm = normalizeLanguageName(customerLanguage)

  if (langNorm === 'Latin American Spanish') {
    return greeting.replace(/^Hola,/, `Hola ${firstName},`)
  }

  if (langNorm === 'Portuguese') {
    return greeting.replace(/^Olá,|^OlÃ¡,/, `Olá ${firstName},`)
  }

  return greeting.replace(/^Hi,/, `Hi ${firstName},`)
}

function getInitialStateQuestion(customerLanguage) {
  return (
    INITIAL_STATE_QUESTION_BY_LANGUAGE[normalizeLanguageName(customerLanguage)] ||
    INITIAL_STATE_QUESTION_BY_LANGUAGE.English
  )
}

async function updateRespondContactState(contactId, state) {
  await updateRespondContact({
    contactId,
    customFields: {
      state,
      State: state,
    },
  }).catch((error) => {
    console.warn(`Unable to update Respond state field: ${error.message}`)
  })
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
    contactPhone: extractRespondContactPhone(contact, getRespondCustomFieldMap(contact)),
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

function preventUnconfirmedBookingReply(text, customerLanguage, messages = [], session = {}) {
  if (hasCustomerAvailabilityQuestion(text) && hasBookingContext({ messages, session })) {
    return bookingCopy(customerLanguage, 'checking')
  }

  if (!hasUnconfirmedBookingLanguage(text)) {
    return text
  }

  const details = extractRespondBookingDetails(messages)

  if (details.phone) {
    // Phone is known; slot will be offered by the booking automation — show checking copy
    return bookingCopy(customerLanguage, 'checking')
  }

  if (normalizeLanguageName(customerLanguage) === 'Latin American Spanish') {
    return 'Por favor enviame el mejor numero de telefono para la llamada. 📲'
  }

  return 'Please send the best phone number for the call. 📲'
}

function hasCustomerAvailabilityQuestion(text) {
  const normalized = normalizeSearchText(text)

  return [
    /\b(what|which)\b[\s\S]{0,40}\b(day|date|time)\b[\s\S]{0,40}\b(work|works|available|free|best)\b/,
    /\bwhen\b[\s\S]{0,60}\b(available|free|work|works)\b/,
    /\bbest\b[\s\S]{0,30}\b(day|date|time|availability)\b/,
    /\bque\b[\s\S]{0,40}\b(dia|fecha|hora|horario)\b[\s\S]{0,40}\b(conviene|funciona|disponible)\b/,
    /\bcuando\b[\s\S]{0,50}\b(disponible|puedes|podrias|te funciona)\b/,
  ].some((pattern) => pattern.test(normalized))
}

function hasBookingContext({ messages = [], session = {} }) {
  const details = extractRespondBookingDetails(messages)
  const booking = session.booking || {}

  return Boolean(
    booking.pendingField ||
      booking.offeredOption ||
      booking.options?.length ||
      details.state ||
      details.desiredTreatment ||
      details.phone ||
      messages.some((item) => item.role === 'user' && isBookingRequest(item.content || '')),
  )
}


function hasUnconfirmedBookingLanguage(text) {
  const normalized = String(text || '').toLowerCase()

  return [
    /\b(booked|scheduled|confirmed|reserved|set)\b[\s\S]{0,80}\b(today|tomorrow|mon|tue|wed|thu|fri|sat|sun|am|pm|est|edt|\d{1,2}:\d{2})\b/,
    /\b(call|appointment|discovery call)\s+is\s+set\b/,
    /\b(i|we)\s+(will|can|shall)\s+send\b[\s\S]{0,80}\b(appointment|details|link|invite)\b/,
    /\b(proceed|go ahead|move forward)\b[\s\S]{0,80}\b(setting up|scheduling|booking|confirming)\b/,
    /\b(check|checking|verify|verifying)\b[\s\S]{0,100}\b(next available|calendar|booking|appointment)\b/,
    /\bsubmit\b[\s\S]{0,80}\b(booking|form|reservation|appointment)\b/,
    /\b(i|we)\s+have\s+availability\b[\s\S]{0,80}\b(today|tomorrow|am|pm|est|edt|\d{1,2}:\d{2})\b/,
    /\bavailable slot\b[\s\S]{0,80}\b(today|tomorrow|am|pm|est|edt|\d{1,2}:\d{2})\b/,
  ].some((pattern) => pattern.test(normalized))
}

function buildInstructions({ agent, instructions, customerLanguage, redundancyControl }) {
  return [
    agent?.systemPrompt,
    customerLanguage
      ? `Session language lock: ${customerLanguage}. You must answer only in ${customerLanguage} for this conversation. Do not switch languages because retrieved examples, company context, prior agent messages, or internal notes use another language.`
      : '',
    redundancyControl,
    'Redundancy control is mandatory: do not ask for a detail the customer already provided in this conversation, and do not repeat prices, product lists, or onboarding explanations already shown unless the customer explicitly asks for them again. If a prior agent message asked for multiple details and the customer supplied one of them, acknowledge the supplied detail and ask only for the missing detail.',
    'For booking qualification, default the customer goal to weight loss. After collecting state, move directly to availability or the next required booking detail. Do not ask a separate main-goals question unless the customer asks for help comparing non-weight-loss options.',
    'Use retrieved company knowledge as supporting context when it is relevant. Do not mention internal source names unless asked. If context is missing, ask a clarifying question or route to a human instead of inventing facts.',
    'Retrieved examples are examples of workflow only. They never override the session language lock.',
    'When retrieved raw conversation examples are relevant, mirror their decision pattern and workflow, but do not copy the example language. Always answer in the customer’s current language. Do not expose internal notes or claim the example conversation is part of the current chat.',
    'Vary your wording naturally. Do not repeat the customer exact phrasing back to them unless needed for clarity. Use the contact name sparingly when known, mainly in the first warm greeting or after a longer gap. Do not use the name in consecutive replies.',
    'Emoji style for model-generated chat replies: include exactly one friendly, relevant emoji in every normal generated customer-facing reply. Choose an emoji that fits the message, such as 📍 for state, 📲 for phone, 💛 for warmth, or ✨ for encouragement. Do not add extra emojis. This rule applies only to generated chat replies; do not rewrite or add emojis to fixed application templates.',
    'If a polite lead says they are not interested, briefly explain how Dharma works, mention that the discovery call is free and online, offer one useful reason to consider it, then gracefully let them go if they still decline.',
    'Guide the lead through the best next step instead of asking them to choose a meeting type. If the customer mentions breastfeeding, pregnancy, side effects, medical conditions, or anything that may make injections inappropriate, do not push injections. Offer nutrition guidance, supplements, or routing to a specialist, and recommend licensed medical guidance for clinical decisions.',
    'Conversation flexibility rule: the booking/state/product flow is important, but customers may ask unrelated or clarifying questions at any point. Answer their question first using available knowledge, then naturally return to the next missing flow step when appropriate. If they ask "what is it about?", "tell me more", "how does it work", pricing, product, company, safety, side-effect, or similar questions while a slot or flow step is active, answer that question before asking them to choose or confirm. Do not repeat a fixed qualification template just because the contact has an out-of-state value saved. When returning to scheduling, never ask what day or time works best for the customer; instead say you will check the next available time or continue collecting the next required booking detail so the application can offer real calendar slots.',
    'Appointments are always online discovery calls, never in-person consultations. The discovery call duration is 20 or 30 minutes depending on the specialist.',
    'When offering a discovery call, offer a real available slot from the booking calendar or ask the application/team to check availability. Never ask generally for the customer best availability as the primary next step.',
    'Never claim that an appointment is booked, scheduled, confirmed, or reserved unless the application booking flow has already returned a successful booking confirmation.',
    'For Respond webhook conversations, do not invent appointment availability. If there is no explicit booking-calendar availability or booking confirmation in the application context, collect the missing booking details instead. The customer phone is required before booking. Never narrate internal workflow or backend implementation details to customers.',
    'Never ask for the customer full address or shipping address during lead qualification or discovery-call booking. State is enough for delivery qualification.',
    'When the customer is in the booking flow or gives scheduling intent, do not ask whether they need more information before booking. Continue to the next missing booking detail or offer a real available calendar slot.',
    'Never confirm refunds, replacements, credits, or compensation in complaint cases. Ask for the order details, issue, photos if relevant, and route the customer to a call or Customer Care.',
    'Use the Respond contact profile context when present. If a customer first name is provided, use only the first name and use it sparingly. Prefer no name in routine booking, slot, and follow-up messages, especially if the prior agent reply already used it. If the identifier is returning_client, treat them as an existing client and route support/client-care needs appropriately. If it is returning_lead, existing_hubspot_contact, or returning_conversation, acknowledge continuity naturally and avoid acting like they are brand new. If it is new_or_no_record, continue the normal new-lead flow. Never reveal internal field names, tags, IDs, or classification labels to the customer.',
    'Booking routing rule: new_or_no_record contacts are booked with the sellers team. returning_client, returning_lead, existing_hubspot_contact, and returning_conversation contacts are booked with the CS Team. Do not tell the customer this internal routing logic.',
    'If a contact says they are already a client, route them to Customer Care. If they ask to speak with doctors or have side effects/medical questions and they are a current prescribed-treatment client, send them to the patient portal: https://telehealth.dharmanutritionclinic.com/dharmanutritionclinic/login. Tell them to log in, go to Messages, then Care Team.',
    'Use "Semaglutide" and "Tirzepatide" for injection names. Do not use "Ozempic" or "Mounjaro" as Dharma product names.',
    'Price follow-up rule: if the customer asks about price or cost again (even if you have shared pricing before), always share the full price list again politely and naturally without saying you already shared it. After sharing the pricing, always follow up immediately with the appropriate state inquiry: in Spanish say "📍Dime por favor en que estado vives para saber si hacemos envios a su Estado?", in Portuguese say "📍Por favor, me informe em que estado você mora para saber se fazemos entregas para o seu Estado?", in English say "📍Please tell us which state you live in to find out if we ship to your state?"',
    'If the customer says the treatment is expensive, explain that the price is for the complete treatment, payment plans may be available with biweekly or monthly payments, accepted payment methods may include debit card, credit card, Venmo, Zelle, Afterpay, Klarna, Affirm, and CareCredit, and the treatment includes personalized attention, dose adjustments when appropriate, and nutrition/activity guidance. Keep it concise and offer a concrete discovery-call slot.',
    `State and product qualification rule: use company knowledge for which products are deliverable in each state. If the customer is out of state for weight-loss injections, do not offer or book a prescribed-treatment appointment and do not claim injections can ship there. If they ask a general question, answer it normally in their language using company knowledge and then gently guide them toward supplements or nutrition support. Only send the exact out-of-state supplement alternative script when the customer is trying to qualify, book, buy, or ship weight-loss injections in a non-serviceable state.

Spanish Template:
💛✨ Por el momento no podemos enviar inyecciones de pérdida de peso a su estado😔.
Pero sí podemos ayudarte con nuestra línea de suplementos Dharma, diseñados para apoyar tu proceso de forma natural:
🔥 *Fat Burner*: acelera el metabolismo, da energía limpia y ayuda a quemar grasa durante el día.
🟠 *Berberine*: controla antojos, reduce azúcar en sangre y baja la inflamación abdominal.
💪 *Creatine*: mejora fuerza, tonifica más rápido y acelera la recuperación para verte más fit.
*Puedes ver todo aquí* 👉 https://dharmanutritionclinic.com/collections/supplements

English Template:
💛✨ At the moment, we cannot ship weight loss injections to your state 😔.
But we can help you with our Dharma supplement line, designed to support your journey naturally:
🔥 *Fat Burner*: speeds up metabolism, provides clean energy, and helps burn fat throughout the day.
🟠 *Berberine*: controls cravings, reduces blood sugar, and lowers abdominal inflammation.
💪 *Creatine*: improves strength, tones faster, and speeds up recovery so you look more fit.
*You can view everything here* 👉 https://dharmanutritionclinic.com/collections/supplements

Portuguese Template:
💛✨ No momento, não podemos enviar injeções de perda de peso para o seu estado😔.
Mas podemos ajudá-lo com nossa linha de suplementos Dharma, desenvolvida para apoiar seu processo de forma natural:
🔥 *Fat Burner*: acelera o metabolismo, dá energia limpa e ajuda a queimar gordura durante o dia.
🟠 *Berberine*: controla os desejos, reduz o açúcar no sangue e diminui a inflamação abdominal.
💪 *Creatine*: melhora a força, tonifica mais rápido e acelera a recuperação para você ficar mais fit.
*Você pode ver tudo aqui* 👉 https://dharmanutritionclinic.com/collections/supplements`,
    'Never refer to Dharma specialists as doctors. Use "specialist" or "medical specialist" only.',
    'Do not ask for the customer name before you have handled their question and appointment timing or availability context. Keep replies concise: answer the customer question first, then ask one follow-up in a separate short paragraph.',
    'Before suggesting leaving the conversation for another day, ask whether the customer has any other questions or concerns you can answer now.',
    instructions,
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim()
}

function buildInput({
  messages = [],
  context,
  message,
  customerLanguage,
  redundancyControl,
  respondContactProfile,
  booking,
}) {
  const parts = []

  if (customerLanguage) {
    parts.push(`Session language lock for the next reply: ${customerLanguage}`)
  }

  if (redundancyControl) {
    parts.push(redundancyControl)
  }

  if (respondContactProfile) {
    parts.push(formatRespondContactProfileForPrompt(respondContactProfile))
  }

  if (booking) {
    parts.push(formatBookingContextForPrompt(booking))
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
  const desiredTreatment = extractDesiredTreatmentName(joined)
  const likelyName = [...userMessages].reverse().map(cleanLikelyName).find((text) => {
    const trimmed = text.trim()
    return isLikelyCustomerName(trimmed)
  })

  if (state) {
    details.push(`state=${state}`)
  }

  if (preferredTime) {
    details.push(`preferred time=${preferredTime}`)
  }

  if (desiredTreatment) {
    details.push(`desired treatment=${desiredTreatment}`)
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
  const normalized = normalizeSearchText(content)
  const aliases = new Map([
    ['dc', 'District of Columbia'],
    ['d c', 'District of Columbia'],
    ['pr', 'Puerto Rico'],
    ['washington dc', 'District of Columbia'],
    ['washington d c', 'District of Columbia'],
  ])

  for (const [alias, state] of aliases.entries()) {
    if (new RegExp(`\\b${escapeRegExp(alias)}\\b`).test(normalized)) {
      return state
    }
  }

  return (
    US_STATES.find((state) => {
      const normalizedState = normalizeSearchText(state)

      return new RegExp(`\\b${escapeRegExp(normalizedState)}\\b`).test(normalized)
    }) ||
    extractNonServiceableLocationName(content) ||
    ''
  )
}

function extractNonServiceableLocationName(content) {
  const normalized = normalizeSearchText(content)

  return (
    NON_SERVICEABLE_LOCATIONS.find((location) => {
      const normalizedLocation = normalizeSearchText(location)

      return new RegExp(`\\b${escapeRegExp(normalizedLocation)}\\b`).test(normalized)
    }) || ''
  )
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

function extractPhoneNumber(content) {
  return (
    String(content || '').match(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4,}/)
      ?.[0] || ''
  )
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

function extractDesiredTreatmentName(content) {
  const searchable = normalizeSearchText(content)
  const compact = searchable.replace(/\s+/g, '')

  if (/\b(peptide|peptides|peptidos|péptidos)\b/.test(searchable)) {
    return 'Other peptides'
  }

  if (/\b(zep|zepbound)\b/.test(searchable)) {
    return 'Weight Loss Injections'
  }

  if (
    /\b(weight loss|lose weight|losing weight|slim down|slimming|fat loss|bajar de peso|perder peso|glp 1|semaglutide|tirzepatide|shot|shots|injection|injections|injectable|medication|meds)\b/.test(
      searchable,
    ) ||
    /(weightloss|loseweight|losingweight|fatloss|slimdown|glp1)/.test(compact)
  ) {
    return 'Weight Loss Injections'
  }

  if (/\b(nutri|nutrition|nutritionist|nutritional|diet|dietitian|meal plan|food plan|consulta|asesoria nutricional|nutricion)\b/.test(searchable)) {
    return 'Nutrition Consultation'
  }

  if (/\b(supp|supps|supplement|supplements|vitamin|vitamins|protein|collagen|greens|probiotic|suplemento|suplementos)\b/.test(searchable)) {
    return 'Supplements'
  }

  return ''
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
    'cuanto',
    'precio',
    'cuesta',
    'informacion',
    'información',
    'ayuda',
    'como',
    'donde',
    'que',
    'hablo',
    'hablar',
    'favor',
    'porfa',
    'buenos dias',
    'buenas tardes',
    'buenas noches',
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
    'how much',
    'price',
    'cost',
    'help',
    'what',
    'where',
    'when',
    'how',
    'yes',
    'please',
    'morning',
    'afternoon',
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
