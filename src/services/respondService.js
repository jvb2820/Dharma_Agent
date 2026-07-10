export const respondService = {
  lookupContact: async ({ contactId }) => {
    const response = await fetch('/api/respond/contact-lookup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ contactId }),
    })
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Unable to check Respond contact.')
    }

    return data.contact
  },

  resetSession: async ({ contactId, all = false } = {}) => {
    const response = await fetch('/api/respond/session/reset', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(all ? { all: true } : { contactId }),
    })
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Unable to reset Respond session.')
    }

    return data
  },
}
