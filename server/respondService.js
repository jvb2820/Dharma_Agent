const RESPOND_API_BASE_URL = 'https://api.respond.io'
const EVALUATION_SCHEDULE_SHORTCUTS = {
  sales: {
    name: '{SP} Evaluation Schedule',
    webhookUrlEnv: 'RESPOND_SP_EVALUATION_SCHEDULE_WEBHOOK_URL',
  },
  customer_service: {
    name: '{CS/FD} CS Evaluation Schedule',
    webhookUrlEnv: 'RESPOND_CS_FD_EVALUATION_SCHEDULE_WEBHOOK_URL',
  },
}

export async function getRespondContact(contactId) {
  if (!contactId) {
    return null
  }

  const token = process.env.RESPOND_API_TOKEN || process.env.RESPONDIO_API_KEY

  if (!token) {
    throw new Error('RESPOND_API_TOKEN is not configured.')
  }

  const response = await fetch(
    `${RESPOND_API_BASE_URL}/v2/contact/${encodeURIComponent(`id:${contactId}`)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  )
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.message || `Respond contact lookup failed with ${response.status}.`)
  }

  return data
}

export async function updateRespondContact({ contactId, fields = {} }) {
  if (!contactId) {
    throw new Error('contactId is required to update a Respond contact.')
  }

  const token = process.env.RESPOND_API_TOKEN || process.env.RESPONDIO_API_KEY

  if (!token) {
    throw new Error('RESPOND_API_TOKEN is not configured.')
  }

  const payload = buildContactUpdatePayload(fields)

  if (Object.keys(payload).length === 0) {
    return null
  }

  const response = await fetch(
    `${RESPOND_API_BASE_URL}/v2/contact/${encodeURIComponent(`id:${contactId}`)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.message || `Respond contact update failed with ${response.status}.`)
  }

  return data
}

export async function sendRespondTextMessage({ contactId, text, channelId }) {
  if (!contactId) {
    throw new Error('contactId is required to send a Respond message.')
  }

  if (!text?.trim()) {
    throw new Error('text is required to send a Respond message.')
  }

  const token = process.env.RESPOND_API_TOKEN || process.env.RESPONDIO_API_KEY

  if (!token) {
    throw new Error('RESPOND_API_TOKEN is not configured.')
  }

  const payload = {
    message: {
      type: 'text',
      text,
    },
  }

  if (channelId) {
    payload.channelId = channelId
  }

  const response = await fetch(
    `${RESPOND_API_BASE_URL}/v2/contact/${encodeURIComponent(`id:${contactId}`)}/message`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.message || `Respond message send failed with ${response.status}.`)
  }

  return data
}

export async function sendRespondImageMessage({ contactId, imageUrl, channelId, caption = '' }) {
  if (!contactId) {
    throw new Error('contactId is required to send a Respond image message.')
  }

  if (!imageUrl?.trim()) {
    throw new Error('imageUrl is required to send a Respond image message.')
  }

  const token = process.env.RESPOND_API_TOKEN || process.env.RESPONDIO_API_KEY

  if (!token) {
    throw new Error('RESPOND_API_TOKEN is not configured.')
  }

  const payload = {
    message: {
      type: 'attachment',
      attachment: {
        type: 'image',
        url: imageUrl,
      },
    },
  }

  if (caption.trim()) {
    payload.message.attachment.caption = caption.trim()
  }

  if (channelId) {
    payload.channelId = channelId
  }

  const response = await fetch(
    `${RESPOND_API_BASE_URL}/v2/contact/${encodeURIComponent(`id:${contactId}`)}/message`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(
      data.message ||
        data.error ||
        `Respond image send failed with ${response.status}: ${JSON.stringify(data)}`,
    )
  }

  return data
}

export async function triggerRespondEvaluationSchedule({
  contactId,
  bookingTeam,
  option,
  booked,
  customer = {},
}) {
  const shortcut =
    bookingTeam === 'customer_service'
      ? EVALUATION_SCHEDULE_SHORTCUTS.customer_service
      : EVALUATION_SCHEDULE_SHORTCUTS.sales
  const webhookUrl = process.env[shortcut.webhookUrlEnv]

  if (!webhookUrl) {
    console.warn(
      `Respond shortcut workflow skipped: ${shortcut.webhookUrlEnv} is not configured for ${shortcut.name}.`,
    )
    return null
  }

  const scheduledAt = option?.startTime || booked?.startTime
  const timezone = option?.timezone || 'America/New_York'
  const scheduleParts = formatRespondScheduleParts(scheduledAt, timezone)
  const specialistValue = resolveRespondSpecialistValue({ bookingTeam, option, booked })
  const payload = {
    contactId,
    shortcut: shortcut.name,
    team: bookingTeam === 'customer_service' ? 'customer_service' : 'sales',
    date: scheduleParts.date,
    time: scheduleParts.time,
    timezone,
    scheduledAt,
    specialistName: booked?.sellerName || option?.sellerName || '',
    specialistValue,
    seller: bookingTeam === 'customer_service' ? undefined : specialistValue,
    customerServiceAgent: bookingTeam === 'customer_service' ? specialistValue : undefined,
    customer: {
      firstName: customer.firstName || '',
      lastName: customer.lastName || '',
      email: customer.email || '',
      phone: customer.phone || '',
    },
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(
      data.message ||
        data.error ||
        `Respond shortcut workflow ${shortcut.name} failed with ${response.status}.`,
    )
  }

  return data
}

function buildContactUpdatePayload(fields) {
  const payload = {}
  const customFields = []

  if (fields.firstName) {
    payload.firstName = fields.firstName
  }

  if (fields.lastName) {
    payload.lastName = fields.lastName
  }

  if (fields.email) {
    payload.email = fields.email
  }

  if (fields.phone) {
    payload.phone = fields.phone
  }

  if (fields.language) {
    payload.language = fields.language
  }

  for (const [name, value] of Object.entries(fields.customFields || {})) {
    if (name && value != null && String(value).trim()) {
      customFields.push({ name, value: String(value).trim() })
    }
  }

  if (customFields.length > 0) {
    payload.custom_fields = customFields
  }

  return payload
}

function resolveRespondSpecialistValue({ bookingTeam, option, booked }) {
  const configuredAliases = parseSpecialistAliasMap(
    bookingTeam === 'customer_service'
      ? process.env.RESPOND_CS_FD_AGENT_ALIASES
      : process.env.RESPOND_SP_SELLER_ALIASES,
  )
  const candidates = [
    booked?.sellerFieldValue,
    option?.sellerFieldValue,
    booked?.sellerName,
    option?.sellerName,
    option?.sellerSlug,
  ].filter(Boolean)
  const aliasKey = candidates.map(normalizeAliasKey).find((candidate) => configuredAliases[candidate])

  if (aliasKey) {
    return configuredAliases[aliasKey]
  }

  const name = booked?.sellerName || option?.sellerName || ''

  if (bookingTeam === 'customer_service') {
    return name.toUpperCase()
  }

  return booked?.sellerFieldValue || option?.sellerFieldValue || name
}

function parseSpecialistAliasMap(value = '') {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((aliases, entry) => {
      const [rawKey, ...rawValueParts] = entry.split(':')
      const key = normalizeAliasKey(rawKey)
      const aliasValue = rawValueParts.join(':').trim()

      if (key && aliasValue) {
        aliases[key] = aliasValue
      }

      return aliases
    }, {})
}

function normalizeAliasKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function formatRespondScheduleParts(timestamp, timezone) {
  if (!timestamp) {
    return { date: '', time: '' }
  }

  const date = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  }).format(new Date(timestamp))
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  }).format(new Date(timestamp))

  return { date, time }
}
