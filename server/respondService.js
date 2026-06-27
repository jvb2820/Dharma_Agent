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
