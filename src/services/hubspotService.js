export const hubspotService = {
  getAvailability: async ({ preferredTime, preferredSpecialist, state, earliestHour, latestStartTime, language } = {}) => {
    const response = await fetch('/api/hubspot/availability', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ limit: 6, preferredTime, preferredSpecialist, state, earliestHour, latestStartTime, language }),
    })
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Unable to get appointment availability.')
    }

    return data.options || []
  },

  bookMeeting: async ({ customer, option }) => {
    const response = await fetch('/api/hubspot/book-meeting', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ customer, option }),
    })
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Unable to book the appointment.')
    }

    return data.booking
  },

  lookupContact: async ({ email }) => {
    const response = await fetch('/api/hubspot/contact-lookup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    })
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Unable to check HubSpot contact.')
    }

    return data
  },
}
