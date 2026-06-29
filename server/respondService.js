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
