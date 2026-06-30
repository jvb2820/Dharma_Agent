const RESPOND_API_BASE_URL = 'https://api.respond.io'

export async function getRespondContact(contactId) {
  if (!contactId) {
    return null
  }

  const token = process.env.RESPOND_API_TOKEN

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
      type: 'image',
      image: {
        url: imageUrl,
      },
    },
  }

  if (caption.trim()) {
    payload.message.text = caption.trim()
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
    throw new Error(data.message || `Respond image send failed with ${response.status}.`)
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
