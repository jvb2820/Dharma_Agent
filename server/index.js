import http from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { buildBookedMessage } from './booked.js'
import { loadLocalEnv } from './env.js'
import {
  formatCustomerStateSlot,
  formatCustomerStateTime,
  getCustomerStateHour,
} from './timezones.js'
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
  assignRespondConversation,
  closeRespondConversation,
  getRespondContact,
  sendRespondImageMessage,
  sendRespondTextMessage,
  unassignRespondConversation,
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
  let respondContactProfile = await getRespondContactProfile(event.contactId, session.respondContactProfile)
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
    await unassignRespondConversationAfterReply(event.contactId)

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
    await unassignRespondConversationAfterReply(event.contactId)

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
  const activeBooking = refreshRespondBookingTeam(
    getActiveRespondBookingForMessage(session.booking, state),
    respondContactProfile,
  )

  if (state) {
    await updateRespondContactState(event.contactId, state)
  }

  const bookingResponse = await handleRespondBookingAutomation({
    session: { ...session, booking: activeBooking },
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
    if (bookingResponse.postReplyRespondAction?.type === 'booked') {
      await finalizeRespondConversationAfterBooking({
        contactId: event.contactId,
        booked: bookingResponse.postReplyRespondAction.booked,
        option: bookingResponse.postReplyRespondAction.option,
      }).catch((error) => {
        console.warn(`Unable to finalize Respond conversation after booking: ${error.message}`)
      })
    } else {
      await unassignRespondConversationAfterReply(event.contactId)
    }

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
    booking: activeBooking,
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
  await unassignRespondConversationAfterReply(event.contactId)

  respondSessions.set(event.contactId, {
    customerLanguage,
    languageAsked: false,
    lastInteractionAt: Date.now(),
    messages: [...messages, { role: 'agent', content: text }].slice(-12),
    booking: activeBooking || null,
    respondContactProfile,
  })
}

function getActiveRespondBookingForMessage(booking, latestState) {
  if (!booking || booking.pendingField !== 'state' || latestState) {
    return booking || null
  }

  return {
    ...booking,
    details: {
      ...(booking.details || {}),
      state: '',
    },
  }
}

function refreshRespondBookingTeam(booking, profile) {
  if (!booking) {
    return null
  }

  const bookingTeam = getCurrentRespondBookingTeam(booking, profile)
  logRespondRoutingDecision('refresh-booking-team', {
    contactStatus: profile?.fields?.contactStatus,
    profileStatus: profile?.status,
    previousBookingTeam: booking.bookingTeam,
    bookingTeam,
  })

  if (bookingTeam === booking.bookingTeam) {
    return booking
  }

  return {
    ...booking,
    bookingTeam,
    teamChanged: true,
  }
}

async function unassignRespondConversationAfterReply(contactId) {
  await unassignRespondConversation(contactId).catch((error) => {
    console.warn(`Unable to unassign Respond conversation: ${error.message}`)
  })
}

async function finalizeRespondConversationAfterBooking({ contactId, booked, option }) {
  const assignment = getRespondAssigneeForBookedSpecialist(booked, option)
  const assignee = assignment.assignee

  if (!assignee) {
    console.warn(
      `Unable to assign and close Respond conversation: no assignee configured for booked specialist ${booked?.sellerSlug || option?.sellerSlug || booked?.sellerName || option?.sellerName || 'unknown'}. Tried keys: ${assignment.keys.join(', ') || 'none'}. Configured keys: ${assignment.configuredKeys.join(', ') || 'none'}.`,
    )
    return
  }

  const assignmentResult = await assignRespondConversation({ contactId, assignee })
    .then((result) => ({ ok: true, result }))
    .catch((error) => ({ ok: false, error }))
  const closeResult = await closeRespondConversation({
    contactId,
    closingNoteId: process.env.RESPOND_BOOKING_CLOSING_NOTE_ID,
  })
    .then((result) => ({ ok: true, result }))
    .catch((error) => ({ ok: false, error }))

  if (!assignmentResult.ok || !closeResult.ok) {
    const failures = [
      assignmentResult.ok ? '' : `assign failed: ${assignmentResult.error.message}`,
      closeResult.ok ? '' : `close failed: ${closeResult.error.message}`,
    ].filter(Boolean)

    throw new Error(failures.join('; '))
  }

  console.log('[respond-booking-finalized]', {
    contactId,
    assignee,
    bookedSpecialist: booked?.sellerSlug || option?.sellerSlug || booked?.sellerName || option?.sellerName,
  })
}

function getRespondAssigneeForBookedSpecialist(booked = {}, option = {}) {
  const assignees = parseRespondAssigneeMap(process.env.RESPOND_BOOKING_ASSIGNEES)
  const keys = [
    booked.sellerSlug,
    option.sellerSlug,
    booked.sellerFieldValue,
    option.sellerFieldValue,
    booked.sellerName,
    option.sellerName,
  ]
    .map((value) => normalizeRespondAssigneeKey(value))
    .filter(Boolean)

  return {
    assignee: keys.map((key) => assignees[key]).find(Boolean) || '',
    keys,
    configuredKeys: Object.keys(assignees),
  }
}

function parseRespondAssigneeMap(value) {
  const text = String(value || '').trim()

  if (!text) {
    return {}
  }

  try {
    const parsed = JSON.parse(text)

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed)
          .map(([key, assignee]) => [normalizeRespondAssigneeKey(key), String(assignee || '').trim()])
          .filter(([key, assignee]) => key && assignee),
      )
    }
  } catch {
    // Allow a compact env format like "alice-f=alice@example.com,arles-martinez=arles@example.com".
  }

  return Object.fromEntries(
    text
      .split(',')
      .map((item) => item.split('='))
      .map(([key, assignee]) => [normalizeRespondAssigneeKey(key), String(assignee || '').trim()])
      .filter(([key, assignee]) => key && assignee),
  )
}

function normalizeRespondAssigneeKey(value) {
  return normalizeSearchText(value).replace(/\s+/g, '-')
}

function logRespondRoutingDecision(stage, details = {}) {
  console.log(
    '[respond-routing]',
    stage,
    Object.fromEntries(
      Object.entries(details).filter(([, value]) => value !== undefined && value !== ''),
    ),
  )
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

async function getRespondContactProfile(contactId, fallbackProfile = null) {
  try {
    const contact = await getRespondContact(contactId)
    return classifyRespondContact(contact)
  } catch (error) {
    console.warn(`Unable to fetch Respond contact profile: ${error.message}`)
    return fallbackProfile || classifyRespondContact(null)
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
  const contactStatus = getRespondContactStatus(customFields, contact)
  const hubspotId = customFields.hubspot_id || ''
  const statusText = [
    contactStatus,
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
  const entries = []

  for (const source of [contact?.custom_fields, contact?.customFields, contact?.customFieldsMap]) {
    if (Array.isArray(source)) {
      entries.push(
        ...source
          .map((field) => [
            field.name || field.label || field.title || field.id || field.key || '',
            normalizeRespondFieldValue(
              field.value ?? field.text ?? field.content ?? field.selectedValue ?? '',
            ),
          ])
          .filter(([name, value]) => name && value != null && String(value).trim()),
      )
    } else if (source && typeof source === 'object') {
      entries.push(
        ...Object.entries(source)
          .map(([name, value]) => [name, normalizeRespondFieldValue(value)])
          .filter(([name, value]) => name && value != null && String(value).trim()),
      )
    }
  }

  const fields = {}

  for (const [name, value] of entries) {
    fields[name] = value
    fields[normalizeRespondFieldKey(name)] = value
  }

  return fields
}

function getRespondTagNames(contact) {
  return (contact?.tags || [])
    .map((tag) => (typeof tag === 'string' ? tag : tag.name || tag.label || ''))
    .filter(Boolean)
}

function buildRespondContactSignalSummary({ customFields, tags, contact }) {
  const phone = extractRespondContactPhone(contact, customFields)
  const contactStatus = getRespondContactStatus(customFields, contact)

  return Object.fromEntries(
    Object.entries({
      leadStatus: customFields.lead_status,
      classification: customFields.classification,
      hasHubspotId: Boolean(customFields.hubspot_id),
      hasPhone: Boolean(phone),
      state: customFields.state || customFields.state1,
      treatment: customFields.treatment || customFields.desired_treatment_form,
      contactStatus,
      lifecycle: contact?.lifecycle,
      tags: tags.length ? tags.join(', ') : '',
    }).filter(([, value]) => Boolean(value)),
  )
}

function getRespondContactStatus(customFields = {}, contact = {}) {
  return (
    customFields.contact_status ||
    customFields.contactstatus ||
    customFields.ContactStatus ||
    customFields['Contact Status'] ||
    customFields.status ||
    contact?.status ||
    ''
  )
}

function normalizeRespondFieldKey(name) {
  return normalizeSearchText(name).replace(/\s+/g, '_')
}

function normalizeRespondFieldValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeRespondFieldValue).filter(Boolean).join(', ')
  }

  if (value && typeof value === 'object') {
    return normalizeRespondFieldValue(
      value.value ?? value.name ?? value.label ?? value.title ?? value.text ?? '',
    )
  }

  return value
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
    booking.pendingField === 'state' && !details.state
      ? 'The next required flow step is the customer state. If the latest customer message asks a question or goes out of flow, answer it briefly first, then ask which state they live in before offering availability or asking for phone.'
      : '',
    'If the latest customer message asks an information question, answer it from company knowledge first. Then briefly return to the current booking flow without asking for details already known or inventing availability.',
  ].filter(Boolean)

  return lines.join('\n')
}

function getBookingTeamForRespondContact(profile) {
  const contactStatus = String(profile?.fields?.contactStatus || '').trim()

  return profile?.status === 'returning_client' || /\bclient\b/i.test(contactStatus)
    ? 'customer_service'
    : 'sales'
}

function getCurrentRespondBookingTeam(existingBooking = {}, profile = {}) {
  const profileBookingTeam = getBookingTeamForRespondContact(profile)
  const hasCurrentRoutingSignal =
    profile?.status === 'returning_client' ||
    Boolean(String(profile?.fields?.contactStatus || '').trim())

  return hasCurrentRoutingSignal
    ? profileBookingTeam
    : existingBooking.bookingTeam || profileBookingTeam
}

async function handleRespondBookingAutomation({
  session,
  messages,
  customerLanguage,
  respondContactProfile,
}) {
  const existingBooking = session.booking || {}
  const bookingTeam = getCurrentRespondBookingTeam(existingBooking, respondContactProfile)
  const latestUserText = [...messages].reverse().find((item) => item.role === 'user')?.content || ''
  const latestSignals = extractRespondBookingDetailsFromText(latestUserText)
  const latestPreferredTime = resolveRespondPreferredTime({
    existingDetails: existingBooking.details,
    latestSignals,
    latestUserText,
  })
  let details = {
    ...getRespondContactBookingDetails(respondContactProfile),
    ...(existingBooking.details || {}),
    ...extractRespondBookingDetails(messages),
    ...latestSignals,
    ...(latestPreferredTime ? { preferredTime: latestPreferredTime } : {}),
  }
  details = applyAvailabilityConstraintFromPreferredTime(details)
  details = withDefaultRespondDesiredTreatment(details)

  if (existingBooking.pendingField === 'state') {
    const state = latestSignals.state

    if (!state) {
      if (isOutOfFlowInfoQuestion(latestUserText)) {
        const answer = await generatePendingStateOutOfFlowAnswer({
          messages,
          latestUserText,
          customerLanguage,
          respondContactProfile,
          booking: {
            ...existingBooking,
            bookingTeam,
            details: { ...details, state: '' },
            pendingField: 'state',
          },
        })

        return {
          text: buildPendingStateOutOfFlowReply(answer, customerLanguage),
          booking: {
            ...existingBooking,
            bookingTeam,
            details: { ...details, state: '' },
            pendingField: 'state',
          },
        }
      }

      const text = getPendingStateRecoveryText(latestUserText, customerLanguage)

      return {
        text,
        booking: {
          ...existingBooking,
          bookingTeam,
          details: { ...details, state: '' },
          pendingField: 'state',
        },
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
      return prependOutOfFlowAnswerIfNeeded({
        response: {
        text: bookingCopy(customerLanguage, 'askPhone'),
        booking: { ...existingBooking, bookingTeam, details: nextDetails, pendingField: '' },
        },
        latestUserText,
        customerLanguage,
        booking: existingBooking,
        details: nextDetails,
      })
    }

    const offer = await offerSoonestRespondSlot({
      booking: { ...existingBooking, bookingTeam, pendingField: '' },
      details: nextDetails,
      customerLanguage,
    })

    return prependOutOfFlowAnswerIfNeeded({
      response: offer,
      latestUserText,
      customerLanguage,
      booking: existingBooking,
      details: nextDetails,
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
      booking: buildBookingWithExcludedOptions({ ...existingBooking, bookingTeam }),
      details: nextDetails,
      customerLanguage,
      preferredTime,
      closest: true,
    })
  }

  if (existingBooking.pendingField === 'phone') {
    if ((existingBooking.offeredOption || existingBooking.options?.length) && latestPreferredTime) {
      const nextDetails = applyAvailabilityConstraintFromPreferredTime({
        ...details,
        ...latestSignals,
        preferredTime: latestPreferredTime,
      })

      return await offerSoonestRespondSlot({
        booking: buildBookingWithExcludedOptions({ ...existingBooking, bookingTeam, pendingField: '' }),
        details: nextDetails,
        customerLanguage,
        preferredTime: nextDetails.preferredTime,
        closest: true,
      })
    }

    const phone = latestSignals.phone || extractPhoneNumber(latestUserText)
    const nextDetails = phone ? { ...details, phone } : details

    if (nextDetails.phone && !existingBooking.offeredOption && !existingBooking.options?.length) {
      return await offerSoonestRespondSlot({
        booking: { ...existingBooking, bookingTeam, pendingField: '' },
        details: nextDetails,
        customerLanguage,
        preferredTime: nextDetails.preferredTime,
        closest: Boolean(nextDetails.preferredTime),
      })
    }

    if (!nextDetails.phone) {
      return {
        text: bookingCopy(customerLanguage, 'askPhone'),
        booking: { ...existingBooking, bookingTeam, details: nextDetails, pendingField: 'phone' },
      }
    }

    if (!nextDetails.firstName || !nextDetails.lastName) {
      return {
        text: bookingCopy(customerLanguage, 'askName'),
        booking: { ...existingBooking, bookingTeam, details: nextDetails, pendingField: 'name' },
      }
    }

    return await bookAcceptedRespondSlot({
      booking: { ...existingBooking, bookingTeam, pendingField: '' },
      details: nextDetails,
      customerLanguage,
    }).catch((error) =>
      buildRespondBookingFailure(
        { ...existingBooking, bookingTeam, pendingField: '' },
        nextDetails,
        customerLanguage,
        error,
      ),
    )
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

    if (!nextDetails.phone) {
      return {
        text: bookingCopy(customerLanguage, 'askPhone'),
        booking: { ...existingBooking, bookingTeam, details: nextDetails, pendingField: 'phone' },
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

  const selectedOption = pickRespondAvailabilityOption(
    latestUserText,
    existingBooking.options,
    details.state,
  )
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
    return buildOutOfFlowAnswerWithBookingContext({
      latestUserText,
      customerLanguage,
      booking: existingBooking,
      details,
    })
  }

  if (hasActiveSlotOffer && !selectedOption && isConversationDeferralReply(latestUserText)) {
    return null
  }

  if (hasActiveSlotOffer && !selectedOption && latestSignals.preferredTime) {
    const nextDetails = {
      ...details,
      ...latestSignals,
      ...(latestPreferredTime ? { preferredTime: latestPreferredTime } : {}),
    }

    return await offerSoonestRespondSlot({
      booking: buildBookingWithExcludedOptions({ ...existingBooking, bookingTeam }),
      details: nextDetails,
      customerLanguage,
      preferredTime: nextDetails.preferredTime,
      closest: true,
    })
  }

  // When the user rejects a single offered slot, offer more alternatives instead of asking for preferred time
  if (existingBooking.offeredOption && isNegativeReply(latestUserText)) {
    const extractedPreferredTime = extractPreferredTimeText(latestUserText)
    const preferredTime =
      resolveRespondPreferredTime({
        existingDetails: details,
        latestSignals: { ...latestSignals, preferredTime: extractedPreferredTime },
        latestUserText,
      }) || (isUnavailableTodayReply(latestUserText) ? 'tomorrow' : '')
    const nextDetails = preferredTime ? { ...details, preferredTime } : details

    return await offerSoonestRespondSlot({
      booking: buildBookingWithExcludedOptions({ ...existingBooking, bookingTeam }),
      details: nextDetails,
      customerLanguage,
      preferredTime,
      closest: true,
    })
  }

  // When user rejects from a list, offer a fresh set of alternatives
  if (existingBooking.options?.length > 1 && isNegativeReply(latestUserText)) {
    const extractedPreferredTime = extractPreferredTimeText(latestUserText)
    const preferredTime =
      resolveRespondPreferredTime({
        existingDetails: details,
        latestSignals: { ...latestSignals, preferredTime: extractedPreferredTime },
        latestUserText,
      }) || (isUnavailableTodayReply(latestUserText) ? 'tomorrow' : '')
    const nextDetails = preferredTime ? { ...details, preferredTime } : details

    return await offerSoonestRespondSlot({
      booking: buildBookingWithExcludedOptions({ ...existingBooking, bookingTeam }),
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

  if (
    existingBooking.teamChanged &&
    hasActiveSlotOffer &&
    (selectedOption || (existingBooking.offeredOption && isAffirmative(latestUserText)))
  ) {
    return await offerSoonestRespondSlot({
      booking: buildBookingWithExcludedOptions({ ...existingBooking, bookingTeam, teamChanged: false }),
      details,
      customerLanguage,
      preferredTime: latestSignals.preferredTime || details.preferredTime,
      closest: true,
    })
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

    if (!details.phone) {
      return {
        text: bookingCopy(customerLanguage, 'askPhone'),
        booking: {
          ...existingBooking,
          bookingTeam,
          details,
          offeredOption: option,
          pendingField: 'phone',
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
  logRespondRoutingDecision('offer-slot', {
    bookingTeam: booking.bookingTeam,
    state: details.state,
    pendingField: booking.pendingField,
    closest,
  })
  const shouldOfferMultipleSlots = shouldOfferMultipleScheduleOptions({
    closest,
    details,
    preferredTime,
  })
  const getAvailability =
    booking.bookingTeam === 'customer_service'
      ? getCustomerServiceAvailability
      : getPrioritySellerAvailability
  const hasTimeConstraint = hasAvailabilityTimeConstraint(details)
  const availabilityLimit = closest || hasTimeConstraint || shouldOfferMultipleSlots ? 100 : 1
  const options = await getAvailability({
    limit: availabilityLimit,
    preferredTime,
  })
  const fallbackOptions =
    closest && options.length === 0
      ? await getAvailability({ limit: 100 })
      : []
  let availableOptions = filterOptionsByAvailabilityPreference(
    options.length ? options : fallbackOptions,
    details,
  )
  availableOptions = filterPreviouslyOfferedOptions(availableOptions, booking)

  if (hasTimeConstraint && availableOptions.length === 0) {
    availableOptions = filterOptionsByAvailabilityPreference(
      await getAvailability({ limit: 100 }),
      details,
    )
    availableOptions = filterPreviouslyOfferedOptions(availableOptions, booking)
  }
  const offeredOption = availableOptions[0]

  if (!offeredOption) {
    return {
      text: bookingCopy(customerLanguage, 'noAvailability'),
      booking: { ...booking, details },
    }
  }

  const nextOptions = [offeredOption]
  const offerKey = getSingleSlotOfferCopyKey({
    closest,
    preferredTime,
    usedFallback: options.length === 0 && fallbackOptions.length > 0,
  })

  return {
    text: nextOptions.length === 1
      ? bookingCopy(customerLanguage, offerKey, {
          slot: formatCustomerStateSlot(nextOptions[0].startTime, details.state, nextOptions[0].timezone),
        })
      : bookingCopy(customerLanguage, closest ? (options.length ? 'offerClosestSlots' : 'offerFallbackSlots') : 'offerSlots', {
          slots: formatNumberedSlots(nextOptions, details.state),
        }),
    booking: {
      details,
      bookingTeam: booking.bookingTeam || 'sales',
      options: nextOptions,
      offeredOption: nextOptions.length === 1 ? nextOptions[0] : null,
      pendingField: '',
      excludedOptions: booking.excludedOptions || [],
    },
  }
}

function hasAvailabilityTimeConstraint(details = {}) {
  return Number.isInteger(details.earliestHour)
}

function getSingleSlotOfferCopyKey({ closest = false, preferredTime = '', usedFallback = false } = {}) {
  if (!closest) {
    return 'offerSlot'
  }

  if (usedFallback || hasExactClockPreference(preferredTime)) {
    return 'offerClosestSlot'
  }

  return hasDayPartPreference(preferredTime) ? 'offerSoonestForDayPart' : 'offerSoonestForDay'
}

function hasExactClockPreference(value) {
  return /\b(?:1[0-2]|0?[1-9])(?::\d{2})?\s*(?:am|pm)\b|\b(after|around|about|at|a las|las)\s+(?:1[0-2]|0?[1-9])\b/i.test(
    String(value || ''),
  )
}

function hasDayPartPreference(value) {
  return /\b(afternoon|evening|morning|tarde|noche|manana|manha|noite)\b/i.test(String(value || ''))
}

function shouldOfferMultipleScheduleOptions({ closest = false, details = {}, preferredTime = '' } = {}) {
  if (process.env.RESPOND_SINGLE_SLOT_OFFERS !== 'false') {
    return false
  }

  if (closest) {
    return false
  }

  if (hasAvailabilityTimeConstraint(details)) {
    return true
  }

  const normalized = normalizeSearchText(preferredTime || details.preferredTime)

  if (!normalized) {
    return false
  }

  return [
    /\b(today|tomorrow|next day|the next day|next available day|day after tomorrow)\b/,
    /\b(hoy|manana|manaña|dia siguiente|proximo dia|pasado manana|pasado manaña)\b/,
    /\b(hoje|amanha|depois de amanha)\b/,
    /\b(morning|afternoon|evening|later today|later on today)\b/,
    /\b(ma[nñ]ana|tarde|noche|manha|manh[aã]|noite)\b/,
    /\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+\d{1,2}\b/,
    /\b\d{1,2}(st|nd|rd|th)\b/,
    /\b\d{1,2}[/-]\d{1,2}\b/,
  ].some((pattern) => pattern.test(normalized))
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

function buildBookingWithExcludedOptions(booking = {}) {
  const excludedOptions = [
    ...(booking.excludedOptions || []),
    booking.offeredOption,
    ...(booking.options || []),
  ].filter(Boolean)

  return {
    ...booking,
    offeredOption: null,
    options: [],
    excludedOptions,
  }
}

function filterPreviouslyOfferedOptions(options = [], booking = {}) {
  const offeredKeys = new Set(
    [
      booking.offeredOption,
      ...(booking.options || []),
      ...(booking.excludedOptions || []),
    ]
      .filter(Boolean)
      .map(getAvailabilityOptionKey),
  )

  if (!offeredKeys.size) {
    return options
  }

  return options.filter((option) => !offeredKeys.has(getAvailabilityOptionKey(option)))
}

function getAvailabilityOptionKey(option = {}) {
  return `${option.sellerSlug || ''}:${option.startTime || ''}`
}

function prependOutOfFlowAnswerIfNeeded({
  response,
  latestUserText,
  customerLanguage,
  booking = {},
  details = {},
}) {
  const answer = getOutOfFlowAnswer(latestUserText, customerLanguage)

  if (!answer || !response?.text) {
    return response
  }

  return {
    ...response,
    text: `${answer}\n\n${response.text}`,
    booking: {
      ...(response.booking || booking),
      details: {
        ...(response.booking?.details || details),
      },
    },
  }
}

function buildOutOfFlowAnswerWithBookingContext({
  latestUserText,
  customerLanguage,
  booking = {},
  details = {},
}) {
  const answer = getOutOfFlowAnswer(latestUserText, customerLanguage)

  if (!answer) {
    return null
  }

  const option = booking.offeredOption || booking.options?.[0]

  if (!option) {
    return {
      text: answer,
      booking: { ...booking, details },
    }
  }

  return {
    text: `${answer}\n\n${bookingCopy(customerLanguage, 'reofferSlot', {
      slot: formatCustomerStateSlot(option.startTime, details.state, option.timezone),
    })}`,
    booking: { ...booking, details, offeredOption: option, options: [] },
  }
}

function getOutOfFlowAnswer(content, customerLanguage) {
  const normalized = normalizeSearchText(content)
  const language = normalizeLanguageName(customerLanguage)
  const spanish = language === 'Latin American Spanish'
  const portuguese = language === 'Portuguese'

  if (!normalized || !isOutOfFlowInfoQuestion(content)) {
    return ''
  }

  if (/\b(cita|appointment|consulta|llamada)\b/.test(normalized) && /\b(precio|cuanto|cost|price|cuesta|custa)\b/.test(normalized)) {
    if (spanish) return 'La llamada de analisis inicial es completamente gratis. En esa llamada te explican las opciones, precios y siguientes pasos sin compromiso.'
    if (portuguese) return 'A chamada inicial de analise e completamente gratuita. Nessa chamada explicam as opcoes, precos e proximos passos sem compromisso.'
    return 'The initial discovery call is completely free. During the call, the specialist explains options, pricing, and next steps with no obligation.'
  }

  if (/\b(price|cost|payment|precio|cuanto|cuesta|costo|pago|preco|quanto custa)\b/.test(normalized)) {
    if (spanish) return 'El paquete personalizado GLP-1 para perdida de peso empieza en $589 por hasta 4 semanas, y el acceso a prescripcion de Zepbound cuesta $299. Los tratamientos mas largos dependen de tu meta.'
    if (portuguese) return 'O pacote personalizado GLP-1 para perda de peso comeca em $589 por ate 4 semanas, e o acesso a prescricao de Zepbound custa $299. Tratamentos mais longos dependem do seu objetivo.'
    return 'The personalized GLP-1 weight-loss package starts at $589 for up to 4 weeks, and Zepbound prescription access is $299. Longer treatments depend on your goal.'
  }

  if (/\b(doctor|doctors|provider|providers|doctor name|medico|medicos|doctor|doctores|nombre del doctor|proveedor|proveedores|doutor|medico)\b/.test(normalized)) {
    if (spanish) return 'La llamada es con un especialista en nuestros tratamientos, no con un doctor. Dharma trabaja con una red de proveedores medicos licenciados en los estados donde ofrecemos servicio; despues de completar el formulario medico, tu caso se asigna a un proveedor autorizado segun tu estado.'
    if (portuguese) return 'A chamada e com um especialista nos nossos tratamentos, nao com um medico. A Dharma trabalha com uma rede de provedores medicos licenciados nos estados atendidos; depois do formulario medico, seu caso e atribuido a um provedor autorizado conforme seu estado.'
    return 'The call is with a treatment specialist, not a doctor. Dharma works with licensed medical providers in the states we serve; after the medical form, your case is assigned to an authorized provider for your state.'
  }

  if (/\b(treatment|program|medication|medicine|injection|semaglutide|tirzepatide|zepbound|glp 1|tratamiento|medicamento|inyeccion|programa|injecao)\b/.test(normalized)) {
    if (spanish) return 'El tratamiento de perdida de peso puede incluir opciones GLP-1 como Semaglutide o Tirzepatide cuando un proveedor medico determina que eres candidata. Primero hacemos una llamada gratis para revisar tu meta, explicar opciones y los siguientes pasos.'
    if (portuguese) return 'O tratamento de perda de peso pode incluir opcoes GLP-1 como Semaglutide ou Tirzepatide quando um provedor medico determina que e adequado. Primeiro fazemos uma chamada gratuita para revisar seu objetivo, explicar opcoes e proximos passos.'
    return 'Weight-loss treatment may include GLP-1 options such as Semaglutide or Tirzepatide when a licensed provider determines it is appropriate. First, we do a free call to review your goal, options, and next steps.'
  }

  if (spanish) return 'Claro, te explico brevemente: la llamada gratis es para revisar tu meta, responder tus dudas y orientarte sobre las opciones disponibles.'
  if (portuguese) return 'Claro, explico brevemente: a chamada gratuita serve para revisar seu objetivo, responder suas duvidas e orientar sobre as opcoes disponiveis.'
  return 'Of course. The free call is to review your goal, answer questions, and guide you through the available options.'
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
    postReplyRespondAction: {
      type: 'booked',
      booked,
      option,
    },
  }
}

function buildRespondBookingFailure(booking, details, customerLanguage, error) {
  console.warn(`Unable to book Respond HubSpot appointment: ${error.message}`)

  return {
    text: bookingCopy(customerLanguage, 'bookingFailed'),
    booking: {
      ...buildBookingWithExcludedOptions(booking),
      details,
      lastBookingError: error.message,
    },
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
    reofferSlot: tri(
      `The available time I have is ${values.slot}. Does that work for you?`,
      `El horario disponible que tengo es ${values.slot}. Te funciona?`,
      `O horario disponivel que tenho e ${values.slot}. Funciona para voce?`,
    ),
    offerSlots: tri(
      `These are the next available options for your free discovery call:\n${values.slots}\n\nWhich option works best? You can reply with the number or the time.`,
      `Estos son los proximos horarios disponibles para tu llamada gratuita:\n${values.slots}\n\nCual opcion te funciona mejor? Puedes responder con el numero o la hora.`,
      `Estes sao os proximos horarios disponiveis para sua chamada gratuita:\n${values.slots}\n\nQual opcao funciona melhor? Voce pode responder com o numero ou o horario.`,
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
    offerSoonestForDay: tri(
      `The soonest available time I have for that day is ${values.slot}. Does that work for you?`,
      `El horario mas pronto disponible que tengo para ese dia es ${values.slot}. Te funciona?`,
      `O horario mais cedo disponivel que tenho para esse dia e ${values.slot}. Funciona para voce?`,
    ),
    offerSoonestForDayPart: tri(
      `The soonest available time I have for that part of the day is ${values.slot}. Does that work for you?`,
      `El horario mas pronto disponible que tengo para esa parte del dia es ${values.slot}. Te funciona?`,
      `O horario mais cedo disponivel que tenho para essa parte do dia e ${values.slot}. Funciona para voce?`,
    ),
    offerClosestSlots: tri(
      `📅 ${named('I do not have that exact time available, but I do have this option:', 'I do not have that exact time available, but I do have this option:')}\n${values.slots}\n\nDoes that work for you?`,
      `${named('no tengo ese horario exacto disponible, pero tengo esta opcion:', 'No tengo ese horario exacto disponible, pero tengo esta opcion:')}\n${values.slots}\n\nTe funciona?`,
      `${named('não tenho exatamente esse horário disponível, mas tenho esta opção:', 'Não tenho exatamente esse horário disponível, mas tenho esta opção:')}\n${values.slots}\n\nFunciona para você?`,
    ),
    offerAlternativeSlots: tri(
      `That time does not work. Here are the next available openings:\n${values.slots}\n\nWhich option works best? Please reply with the number.`,
      `Ese horario no funciona. Estos son los proximos espacios disponibles:\n${values.slots}\n\nCual opcion te funciona mejor? Responde con el numero.`,
      `Esse horário não funciona. Estes são os próximos horários disponíveis:\n${values.slots}\n\nQual opção funciona melhor? Responda com o número.`,
    ),
    offerFallbackSlots: tri(
      `📅 ${named('I do not have availability for that requested time right now, but I do have this option:', 'I do not have availability for that requested time right now, but I do have this option:')}\n${values.slots}\n\nDoes that work for you?`,
      `${named('no tengo disponibilidad para ese horario en este momento, pero tengo esta opcion:', 'No tengo disponibilidad para ese horario en este momento, pero tengo esta opcion:')}\n${values.slots}\n\nTe funciona?`,
      `${named('não tenho disponibilidade para esse horário agora, mas tenho esta opção:', 'Não tenho disponibilidade para esse horário agora, mas tenho esta opção:')}\n${values.slots}\n\nFunciona para você?`,
    ),
    askChooseOption: tri(
      'Which option works best? Please reply with the number or the time so I can book it.',
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

function getPendingStateRecoveryText(content, customerLanguage) {
  const normalized = normalizeSearchText(content)
  const askState = bookingCopy(customerLanguage, 'askState')
  const language = normalizeLanguageName(customerLanguage)

  if (isGreetingOnly(content)) {
    return `${acknowledgeGreeting(customerLanguage)} ${askState}`
  }

  if (isBookingRequest(content)) {
    if (language === 'Latin American Spanish') {
      return `Claro, te ayudo con los horarios. Primero necesito confirmar tu estado para revisar la disponibilidad correcta.\n\n${askState}`
    }

    if (language === 'Portuguese') {
      return `Claro, eu te ajudo com os horarios. Primeiro preciso confirmar seu estado para verificar a disponibilidade correta.\n\n${askState}`
    }

    return `Of course, I can help with available times. First I need to confirm your state so I can check the right availability.\n\n${askState}`
  }

  if (isGoalOrTreatmentStatement(normalized) || extractDesiredTreatmentName(content)) {
    if (language === 'Latin American Spanish') {
      return `Claro, te podemos orientar con las opciones de tratamiento. Para confirmar si hacemos envios a tu estado, dime por favor en que estado vives?`
    }

    if (language === 'Portuguese') {
      return `Claro, podemos te orientar com as opcoes de tratamento. Para confirmar se fazemos entregas no seu estado, por favor me diga em que estado voce mora?`
    }

    return `Of course, we can guide you through the treatment options. To confirm whether we ship to your state, please tell us which state you live in?`
  }

  return askState
}

async function generatePendingStateOutOfFlowAnswer({
  messages,
  latestUserText,
  customerLanguage,
  respondContactProfile,
  booking,
}) {
  const fallbackAnswer = getOutOfFlowAnswer(latestUserText, customerLanguage)
  const ragContext = await buildRagContext({
    agent: RESPOND_AGENT,
    messages,
    message: latestUserText,
  })
  const instructions = buildInstructions({
    agent: RESPOND_AGENT,
    customerLanguage,
    instructions: [
      'The customer has not provided their state yet. Answer the latest customer question directly using retrieved company knowledge and the conversation context.',
      'Do not ask for phone number, appointment availability, name, or booking confirmation in this answer.',
      'Do not ask for state, location, shipping availability, or where they live in this answer; the application will append one state question after your answer.',
      'Do not start with a greeting. Keep it concise but specific enough to actually answer the question.',
    ].join('\n'),
  })
  const input = buildInput({
    messages,
    message: latestUserText,
    customerLanguage,
    context: ragContext,
    respondContactProfile,
    booking,
  })

  return createOpenAIResponseText({
    model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
    instructions,
    input,
  }).catch((error) => {
    console.warn(`Unable to generate pending-state answer: ${error.message}`)
    return fallbackAnswer
  })
}

function buildPendingStateOutOfFlowReply(answer, customerLanguage) {
  const askState = bookingCopy(customerLanguage, 'askState')
  const cleanedAnswer = stripStateQuestionFromGeneratedAnswer(answer)

  return cleanedAnswer ? `${cleanedAnswer}\n\n${askState}` : askState
}

function stripStateQuestionFromGeneratedAnswer(answer) {
  return String(answer || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !isStateQuestionLine(line))
    .join('\n\n')
    .trim()
}

function isStateQuestionLine(line) {
  const normalized = normalizeSearchText(line)

  return /\b(state|estado|estado|where do you live|which state|que estado|qual estado|shipping availability|ship to your state|envios|entregas)\b/.test(
    normalized,
  )
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

function pickRespondAvailabilityOption(content, options = [], state = '') {
  const normalized = normalizeSearchText(content)
  const selectedId =
    normalized.match(/^(?:option|number|slot|opcion|opción|numero|número|la|el)?\s*(\d{1,2})$/)?.[1] ||
    normalized.match(/\b(?:option|number|slot|opcion|opción|numero|número|la|el)\s+(\d{1,2})\b/)?.[1]

  return options.find((option) => option.id === selectedId) ||
    pickRespondAvailabilityOptionByTime(content, options, state) ||
    null
}

function pickRespondAvailabilityOptionByTime(content, options = [], state = '') {
  if (!options.length) {
    return null
  }

  const requestedTime = extractRequestedSlotTime(content)

  if (!requestedTime) {
    return null
  }

  const requestedDate = extractRequestedSlotDate(content)
  const requestedWeekday = extractRequestedSlotWeekday(content)
  const candidateOptions = options.filter((option) => {
    const optionTime = getOptionCustomerTime(option, state)

    if (!optionTime || optionTime.hour !== requestedTime.hour) {
      return false
    }

    if (requestedTime.minute != null && optionTime.minute !== requestedTime.minute) {
      return false
    }

    if (requestedDate && requestedDate !== getOptionCustomerDateKey(option, state)) {
      return false
    }

    if (requestedWeekday && requestedWeekday !== getOptionCustomerWeekdayKey(option, state)) {
      return false
    }

    return true
  })

  return candidateOptions.length === 1 ? candidateOptions[0] : null
}

function extractRequestedSlotTime(content) {
  const match = String(content || '').match(/\b(1[0-2]|0?[1-9])(?::(\d{2}))?\s*(am|pm)\b/i)

  if (!match) {
    return null
  }

  let hour = Number(match[1])
  const minute = match[2] == null ? null : Number(match[2])
  const period = match[3].toLowerCase()

  if (period === 'pm' && hour < 12) {
    hour += 12
  }

  if (period === 'am' && hour === 12) {
    hour = 0
  }

  return { hour, minute }
}

function extractRequestedSlotDate(content) {
  const monthDayMatch = String(content || '').match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
  )

  return monthDayMatch
    ? `${monthDayMatch[1].slice(0, 3).toLowerCase()} ${Number(monthDayMatch[2])}`
    : ''
}

function extractRequestedSlotWeekday(content) {
  const match = String(content || '').match(
    /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|domingo|lunes|martes|miercoles|mi[eÃ©]rcoles|jueves|viernes|sabado|s[aÃ¡]bado)\b/i,
  )

  return match ? normalizeSearchText(match[1]) : ''
}

function getOptionCustomerTime(option, state = '') {
  const timeText = formatCustomerStateTime(option.startTime, state, option.timezone)
  const match = timeText.match(/\b(1[0-2]|0?[1-9])(?::(\d{2}))?\s*(am|pm)\b/i)

  if (!match) {
    return null
  }

  let hour = Number(match[1])
  const minute = Number(match[2] || 0)
  const period = match[3].toLowerCase()

  if (period === 'pm' && hour < 12) {
    hour += 12
  }

  if (period === 'am' && hour === 12) {
    hour = 0
  }

  return { hour, minute }
}

function getOptionCustomerDateKey(option, state = '') {
  const slotText = formatCustomerStateSlot(option.startTime, state, option.timezone)
  const match = slotText.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})\b/i,
  )

  return match ? `${match[1].slice(0, 3).toLowerCase()} ${Number(match[2])}` : ''
}

function getOptionCustomerWeekdayKey(option, state = '') {
  return normalizeSearchText(formatCustomerStateSlot(option.startTime, state, option.timezone).split(',')[0])
}

function isActiveBookingContinuation(booking, latestUserText) {
  if (booking.pendingField) {
    return true
  }

  if (booking.options?.length > 0 || booking.offeredOption) {
    return (
      pickRespondAvailabilityOption(latestUserText, booking.options, booking.details?.state) ||
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
    /\b(what|whats|what is|tell me|explain|learn more|more about|about your|about the|how does|how do|how it works|what happens|what includes|included|difference|safe|side effect|side effects|price|cost|payment|company|clinic|program|treatment|medication|medicine|injection|semaglutide|tirzepatide|zepbound|glp 1|supplement|nutrition|peptide|doctor|doctors|provider|providers|fda|approved|review|reviews)\b/.test(normalized),
    /\b(que es|de que|explica|explicame|quiero saber|mas informacion|mas sobre|como funciona|que incluye|incluye|diferencia|seguro|efectos secundarios|precio|cuanto|costo|pago|compania|clinica|programa|tratamiento|medicamento|inyeccion|suplemento|nutricion|peptido|doctor|doctores|medico|medicos|proveedor|proveedores|fda|aprobado|resena|resenas)\b/.test(normalized),
    /\b(o que e|explique|quero saber|mais informacao|mais sobre|como funciona|o que inclui|inclui|diferenca|seguro|efeitos colaterais|preco|quanto custa|custo|pagamento|empresa|clinica|programa|tratamento|medicamento|injecao|suplemento|nutricao|peptideo|doutor|doutores|medico|medicos|provedor|provedores|fda|aprovado|avaliacao|avaliacoes)\b/.test(normalized),
  ].some(Boolean)
}

function isConversationDeferralReply(content) {
  const normalized = normalizeSearchText(content)

  return [
    /\b(no thank you|no thanks|thanks but no|talk to you later|talk later|another time|some other time|not now|later maybe|i ll contact|i will contact)\b/,
    /\b(no gracias|hablamos luego|te contacto luego|otro dia|otra ocasion|en otro momento|ahora no|luego veo|despues veo)\b/,
    /\b(nao obrigada|nao obrigado|falo depois|volto a contactar|volto a contatar|outro dia|outra hora|outro momento|agora nao)\b/,
  ].some((pattern) => pattern.test(normalized))
}

function getPositiveAvailabilityPreferenceText(content) {
  const text = String(content || '').trim()

  if (!text) {
    return ''
  }

  const positiveMatch = text.match(
    /\b(?:just|only|except|but|solo|solamente|excepto|pero|s[oó]|apenas|mas)\b\s+(.+)$/i,
  )

  if (positiveMatch) {
    return positiveMatch[1].trim()
  }

  const positiveNeedMatch = text.match(
    /\b(?:i\s+need|need|i\s+can\s+do|can\s+do|i\s+am\s+available|i'm\s+available|available\s+for|works\s+for\s+me|me\s+funciona|necesito|puedo|estoy\s+disponible|preciso|posso|estou\s+disponivel)\b\s+(.+)$/i,
  )

  if (positiveNeedMatch && hasAvailabilityDateOrTimeSignal(positiveNeedMatch[1])) {
    return positiveNeedMatch[1].trim()
  }

  const availabilityAfterNegativeMatch = text.match(
    /\b(?:no|nope|nah|not that|that doesn't work|that does not work|no puedo|no me funciona|nao funciona|nao posso)\b[\s,.;:-]*(?:i'?m\s+)?(?:only\s+)?(?:available|free|disponible|puedo|posso)?\s*(.+)$/i,
  )

  if (
    availabilityAfterNegativeMatch &&
    hasAvailabilityDateOrTimeSignal(availabilityAfterNegativeMatch[1])
  ) {
    return availabilityAfterNegativeMatch[1].trim()
  }

  const normalized = normalizeSearchText(text)

  if (
    /\b(afternoon|tarde)\b[\s\S]{0,40}\b(good|works|is good|works for me|fine|ok|okay|me funciona|esta bien)\b/.test(
      normalized,
    ) ||
    /\b(can t|cannot|cant|can not|not available|doesn t work|doesnt work)\b[\s\S]{0,40}\b(morning)\b/.test(
      normalized,
    ) ||
    /\b(no puedo|no me funciona|no estoy disponible)\b[\s\S]{0,40}\b(manana|maÃ±ana)\b/.test(
      normalized,
    )
  ) {
    return 'afternoon'
  }

  if (
    /\b(evening|night|noche|noite)\b[\s\S]{0,40}\b(good|works|is good|works for me|fine|ok|okay|me funciona|esta bien)\b/.test(
      normalized,
    )
  ) {
    return 'evening'
  }

  return isNegatedAvailabilityPreference(text) ? '' : text
}

function hasAvailabilityDateOrTimeSignal(content) {
  const normalized = normalizeSearchText(content)

  return [
    /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|am|pm)\b/,
    /\b(hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|tarde|noche)\b/,
    /\b(hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|tarde|noite)\b/,
    /\b\d{1,2}(?::\d{2})?\s*(am|pm)?\b/,
  ].some((pattern) => pattern.test(normalized))
}

function isNegatedAvailabilityPreference(content) {
  const normalized = normalizeSearchText(content)

  return [
    /\b(can t|cannot|cant|can not|won t|wont|unable|not available|doesn t work|doesnt work)\b[\s\S]{0,40}\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|\d{1,2}(?::\d{2})?)\b/,
    /\b(no puedo|no podre|no podria|no me funciona|no estoy disponible)\b[\s\S]{0,40}\b(hoy|manana|dia siguiente|lunes|martes|miercoles|jueves|viernes|sabado|domingo|tarde|noche|\d{1,2}(?::\d{2})?)\b/,
    /\b(nao posso|nao consigo|nao estou disponivel|nao funciona)\b[\s\S]{0,40}\b(hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|tarde|noite|\d{1,2}(?::\d{2})?)\b/,
  ].some((pattern) => pattern.test(normalized))
}

function extractAvailabilityPreference(content) {
  const preferenceText = getPositiveAvailabilityPreferenceText(content)
  const normalized = normalizeSearchText(preferenceText)
  const combinedTomorrowPart = getCombinedTomorrowDayPartPreference(normalized)

  if (combinedTomorrowPart) {
    return combinedTomorrowPart
  }

  if (!normalized) {
    return { hasPreference: false }
  }

  if (/\b(day after tomorrow|pasado manana|pasado manaña|depois de amanha)\b/.test(normalized)) {
    return {
      hasPreference: true,
      preferredTime: 'day after tomorrow',
      dayPart: '',
    }
  }

  if (/\b(tomorrow|next day|the next day|next available day|manana|manaña|dia siguiente|proximo dia|amanha)\b/.test(normalized)) {
    return {
      hasPreference: true,
      preferredTime: 'tomorrow',
      dayPart: '',
    }
  }

  if (/\b(later|later today|later on today|mas tarde|mas tarde hoy|mas tarde hoje)\b/.test(normalized)) {
    return {
      hasPreference: true,
      preferredTime: 'afternoon',
      earliestHour: 12,
      dayPart: 'afternoon',
    }
  }

  if (/^(afternoon|tarde)$/.test(normalized)) {
    return {
      hasPreference: true,
      preferredTime: 'afternoon',
      earliestHour: 12,
      dayPart: 'afternoon',
    }
  }

  if (/^(morning|manana|manha)$/.test(normalized)) {
    return {
      hasPreference: true,
      preferredTime: 'morning',
      earliestHour: 0,
      dayPart: 'morning',
    }
  }

  if (/^(evening|night|noche|noite)$/.test(normalized)) {
    return {
      hasPreference: true,
      preferredTime: 'evening',
      earliestHour: 17,
      dayPart: 'evening',
    }
  }

  const afterHourPatterns = [
    /\b(?:after|later than|from)\s+(?:las\s+)?(\d{1,2})(?::\d{2})?\s*(am|pm)?\b/,
    /\b(?:despues de|despues de las|a partir de|a partir de las|mas tarde de|mas tarde de las|despues)\s+(\d{1,2})(?::\d{2})?\s*(am|pm)?\b/,
    /\b(?:después de|después de las|más tarde de|más tarde de las)\s+(\d{1,2})(?::\d{2})?\s*(am|pm)?\b/i,
  ]

  for (const pattern of afterHourPatterns) {
    const match = String(preferenceText || '').match(pattern)

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

function resolveRespondPreferredTime({ existingDetails = {}, latestSignals = {}, latestUserText = '' } = {}) {
  const explicitPreferredTime = latestSignals.preferredTime || ''
  const existingPreferredTime = existingDetails?.preferredTime || ''
  const latestAvailabilityPreference = extractAvailabilityPreference(latestUserText)

  if (isUnavailableTodayReply(latestUserText)) {
    return 'tomorrow'
  }

  if (!explicitPreferredTime && !latestAvailabilityPreference.hasPreference) {
    return existingPreferredTime
  }

  const datePart =
    extractPreferredDatePhrase(explicitPreferredTime) ||
    extractPreferredDatePhrase(latestUserText) ||
    extractPreferredDatePhrase(existingPreferredTime)
  const timePart =
    extractPreferredClockOrDayPart(explicitPreferredTime) ||
    extractPreferredClockOrDayPart(latestUserText)

  if (datePart && timePart) {
    return `${datePart} ${timePart}`.trim()
  }

  if (explicitPreferredTime && extractPreferredDatePhrase(explicitPreferredTime)) {
    return explicitPreferredTime
  }

  if (explicitPreferredTime && extractPreferredClockOrDayPart(explicitPreferredTime) && datePart) {
    return `${datePart} ${explicitPreferredTime}`.trim()
  }

  return explicitPreferredTime || existingPreferredTime
}

function applyAvailabilityConstraintFromPreferredTime(details = {}) {
  const normalized = normalizeSearchText(details.preferredTime)

  if (!normalized || Number.isInteger(details.earliestHour)) {
    return details
  }

  if (/\b(after 5pm|5pm|5 pm|evening|noche)\b/.test(normalized)) {
    return { ...details, earliestHour: 17, dayPart: 'evening' }
  }

  if (/\b(afternoon|tarde)\b/.test(normalized)) {
    return { ...details, earliestHour: 12, dayPart: 'afternoon' }
  }

  return details
}

function getCombinedTomorrowDayPartPreference(normalized) {
  if (!hasTomorrowSignal(normalized) || !/\b(afternoon|tarde|evening|noche|5pm|after 5|after five)\b/.test(normalized)) {
    return null
  }

  const evening = /\b(evening|noche|5pm|after 5|after five)\b/.test(normalized)

  return {
    hasPreference: true,
    preferredTime: evening ? 'tomorrow after 5pm' : 'tomorrow afternoon',
    earliestHour: evening ? 17 : 12,
    dayPart: evening ? 'evening' : 'afternoon',
  }
}

function hasTomorrowSignal(normalized) {
  return /\b(tomorrow|next day|the next day|next available day|manana|dia siguiente|proximo dia|amanha)\b/.test(
    normalized,
  )
}

function isUnavailableTodayReply(content) {
  const normalized = normalizeSearchText(content)

  return [
    /\b(can t|cannot|cant|can not|not available|doesn t work|doesnt work|no)\b[\s\S]{0,40}\b(today)\b/,
    /\b(no puedo|no podre|no podria|no me funciona|no estoy disponible|no)\b[\s\S]{0,40}\b(hoy)\b/,
    /\b(nao posso|nao consigo|nao estou disponivel|nao funciona|nao)\b[\s\S]{0,40}\b(hoje)\b/,
  ].some((pattern) => pattern.test(normalized))
}

function extractPreferredDatePhrase(content) {
  const normalized = normalizeSearchText(content)

  if (/\b(day after tomorrow|pasado manana|pasado manana|depois de amanha)\b/.test(normalized)) {
    return 'day after tomorrow'
  }

  if (/\b(tomorrow|next day|the next day|next available day|manana|dia siguiente|proximo dia|amanha)\b/.test(normalized)) {
    return 'tomorrow'
  }

  if (/\b(today|hoy|hoje)\b/.test(normalized)) {
    return 'today'
  }

  const explicitDate = String(content || '').match(
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?\b|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/i,
  )

  return explicitDate?.[0]?.trim() || ''
}

function extractPreferredClockOrDayPart(content) {
  const normalized = normalizeSearchText(content)
  const clock = String(content || '').match(/\b(?:around|about|like|como|a las|las|at)?\s*(1[0-2]|0?[1-9])(?::\d{2})?\s*(am|pm)\b/i)

  if (clock) {
    return clock[0].trim()
  }

  const bareHour = String(content || '').match(/\b(?:around|about|like|como|a las|las|at)\s+(1[0-2]|0?[1-9])\b/i)

  if (bareHour) {
    const hour = Number(bareHour[1])
    return `${hour}${hour >= 8 && hour <= 11 ? 'am' : 'pm'}`
  }

  if (/\b(after 5|after five|5pm|evening|noche|por la noche|en la noche)\b/.test(normalized)) {
    return 'after 5pm'
  }

  if (/\b(afternoon|por la tarde|en la tarde|tarde)\b/.test(normalized)) {
    return 'afternoon'
  }

  if (/\b(morning|manana|por la manana|en la manana)\b/.test(normalized)) {
    return 'morning'
  }

  return ''
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
    /\b(check|checking|verify|verifying)\b[\s\S]{0,100}\b(next available|availability|available|calendar|booking|appointment|slot|time)\b/,
    /\bsubmit\b[\s\S]{0,80}\b(booking|form|reservation|appointment)\b/,
    /\b(i|we)\s+have\s+availability\b[\s\S]{0,80}\b(today|tomorrow|am|pm|est|edt|\d{1,2}:\d{2})\b/,
    /\bavailable slot\b[\s\S]{0,80}\b(today|tomorrow|am|pm|est|edt|\d{1,2}:\d{2})\b/,
    /\b(confirm|confirmar|confirme|schedule|book|agendar|agendare|agendar[eÃ©]|programar)\b[\s\S]{0,120}\b(cita|appointment|llamada|call)\b/,
    /\b(te|le)\s+(agendo|agendare|agendar[eÃ©]|confirmo|confirmare|confirmar[eÃ©])\b/,
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
    'Vary your wording naturally. Do not repeat the customer exact phrasing back to them unless needed for clarity. Use the contact name sparingly when known, mainly in the first warm greeting or after a longer gap. Do not use the name in consecutive replies. In an ongoing conversation, do not start routine replies with a fresh greeting such as "Hi", "Hello", "Hola", or "Olá"; just answer the message.',
    'Mid-flow question rule: if the customer asks a question while a slot or booking step is active, answer directly without a greeting, then return to the same current booking step. Do not reset the conversation, and do not ask whether they have more questions before booking.',
    'Emoji style for model-generated chat replies: include exactly one friendly, relevant emoji in every normal generated customer-facing reply. Choose an emoji that fits the message, such as 📍 for state, 📲 for phone, 💛 for warmth, or ✨ for encouragement. Do not add extra emojis. This rule applies only to generated chat replies; do not rewrite or add emojis to fixed application templates.',
    'If a polite lead says they are not interested, says no thank you, asks to talk later, or says another time, ask whether they have any questions or concerns you can answer before booking or before they go. Keep it warm and do not immediately close the conversation.',
    'Guide the lead through the best next step instead of asking them to choose a meeting type. If the customer mentions breastfeeding, pregnancy, side effects, medical conditions, or anything that may make injections inappropriate, do not push injections. Offer nutrition guidance, supplements, or routing to a specialist, and recommend licensed medical guidance for clinical decisions.',
    'Conversation flexibility rule: the booking/state/product flow is important, but customers may ask unrelated or clarifying questions at any point. Answer their question first using available knowledge, then naturally return to the next missing flow step when appropriate. If they ask "what is it about?", "tell me more", "how does it work", pricing, product, company, safety, side-effect, or similar questions while a slot or flow step is active, answer that question before asking them to choose or confirm. Do not repeat a fixed qualification template just because the contact has an out-of-state value saved. When returning to scheduling, never ask what day or time works best for the customer; instead say you will check the next available time or continue collecting the next required booking detail so the application can offer real calendar slots.',
    'Appointments are always online discovery calls, never in-person consultations. The discovery call duration is 20 or 30 minutes depending on the specialist. If the customer asks whether the appointment or discovery call costs money, answer clearly that the discovery call is free and the specialist will explain treatment options, pricing, and next steps during the call.',
    'When offering a discovery call, offer a real available slot from the booking calendar or ask the application/team to check availability. Never ask generally for the customer best availability as the primary next step.',
    'Offer only one appointment option at a time unless the application explicitly provides numbered options. Preserve the customer latest date preference when they refine time; for example, if they said tomorrow and then ask for afternoon or 5pm, keep searching tomorrow, not today.',
    'Never claim that an appointment is booked, scheduled, confirmed, or reserved unless the application booking flow has already returned a successful booking confirmation.',
    'For Respond webhook conversations, do not invent appointment availability. If there is no explicit booking-calendar availability or booking confirmation in the application context, collect the missing booking details instead. The customer phone is required before booking. Never narrate internal workflow or backend implementation details to customers.',
    'Never ask for the customer full address or shipping address during lead qualification or discovery-call booking. State is enough for delivery qualification.',
    'When the customer is in the booking flow or gives scheduling intent, do not ask whether they need more information before booking. Continue to the next missing booking detail or offer a real available calendar slot.',
    'Never confirm refunds, replacements, credits, or compensation in complaint cases. Ask for the order details, issue, photos if relevant, and route the customer to a call or Customer Care.',
    'Use the Respond contact profile context when present. If a customer first name is provided, use only the first name and use it sparingly. Prefer no name in routine booking, slot, and follow-up messages, especially if the prior agent reply already used it. If the identifier is returning_client, treat them as an existing client and route support/client-care needs appropriately. If it is returning_lead, existing_hubspot_contact, or returning_conversation, acknowledge continuity naturally and avoid acting like they are brand new. If it is new_or_no_record, continue the normal new-lead flow. Never reveal internal field names, tags, IDs, or classification labels to the customer.',
    'Booking routing rule: contacts whose Respond Contact Status field is exactly "Client" are booked with the CS Team. All other contact statuses are booked with the sellers team. Do not tell the customer this internal routing logic.',
    'If a contact says they are already a client, route them to Customer Care. If they ask to speak with doctors or have side effects/medical questions and they are a current prescribed-treatment client, send them to the patient portal: https://telehealth.dharmanutritionclinic.com/dharmanutritionclinic/login. Tell them to log in, go to Messages, then Care Team.',
    'Use "Semaglutide" and "Tirzepatide" for injection names. Do not use "Ozempic" or "Mounjaro" as Dharma product names. If asked about FDA approval, do not say compounded Semaglutide or compounded Tirzepatide are FDA-approved. Explain that FDA-approved branded medications include Wegovy and Zepbound, and Dharma uses the same active compounds with licensed medical oversight when appropriate.',
    'Price follow-up rule: if the customer asks about price or cost again, answer directly without a greeting. Share that the personalized GLP-1 package starts at $589 for up to 4 weeks, Zepbound prescription access is $299, and longer treatments depend on the goal. If a real slot is already active, briefly return to that one slot after answering; otherwise follow up with the appropriate state inquiry: in Spanish say "📍Dime por favor en que estado vives para saber si hacemos envios a su Estado?", in Portuguese say "📍Por favor, me informe em que estado você mora para saber se fazemos entregas para o seu Estado?", in English say "📍Please tell us which state you live in to find out if we ship to your state?"',
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
    'Never refer to Dharma sellers/treatment specialists as doctors or medical doctors. Call them "specialists in our treatments" or "treatment specialists", not "medical specialists". If a customer asks for the doctor/provider name, separate the answer: Dharma works with a network of providers licensed in the states we serve, and after the customer completes the medical form their case is assigned to a provider licensed in their home state. Separately, the sales/support specialists guide treatment information and scheduling but are not doctors.',
    'Do not disclose or imply any client, celebrity, or public figure treatment details, including Dayanara Torres. If asked, say privacy rules prevent sharing any client treatment information, then offer to explain Dharma treatment options according to the customer goal.',
    'When discussing trust or legitimacy, say Dharma Clinic is LegitScript-certified and has more than 1500 positive Google reviews.',
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
  const preferenceText = getPositiveAvailabilityPreferenceText(content)

  if (!preferenceText) {
    return ''
  }

  const dateTimeMatch = preferenceText.match(
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:\s+(?:at\s+)?)?(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?\b|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?(?:\s+(?:at\s+)?)?(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?\b/i,
  )

  if (dateTimeMatch) {
    return dateTimeMatch[0].trim()
  }

  const timeMatch = preferenceText.match(/\b(?:1[0-2]|0?[1-9])(?::\d{2})?\s*(?:am|pm)\b/i)

  if (timeMatch) {
    return timeMatch[0]
  }

  const ordinalDayMatch = preferenceText.match(/\b\d{1,2}(?:st|nd|rd|th)\b/i)

  if (ordinalDayMatch) {
    return ordinalDayMatch[0]
  }

  const weekdayDayPartMatch = preferenceText.match(
    /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+(morning|afternoon|evening)\b/i,
  )

  if (weekdayDayPartMatch) {
    return weekdayDayPartMatch[0]
  }

  const weekdayMatch = preferenceText.match(
    /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|domingo|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|segunda|terca|terça|quarta|quinta|sexta)\b/i,
  )

  if (weekdayMatch) {
    return weekdayMatch[0]
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

  const userMessages = [
    message || '',
    ...[...messages].reverse().filter((item) => item.role === 'user').map((item) => item.content || ''),
  ].filter((content) => content.trim())

  for (const content of userMessages) {
    const detectedLanguage = detectCustomerLanguage(content)

    if (detectedLanguage) {
      return detectedLanguage
    }
  }

  return providedLanguage
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
    'evening',
    'tomorrow',
    'today',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
    "can't",
    'cannot',
    'can not',
    'make it',
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
