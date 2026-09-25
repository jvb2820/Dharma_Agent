export const reportService = {
  getBookings: async ({ from = '', to = '' } = {}) => {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const response = await fetch(`/api/reports/bookings?${params}`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Unable to load the booking report.')
    return data
  },
  getConversations: async ({ from = '', to = '' } = {}) => {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const response = await fetch(`/api/reports/conversations?${params}`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Unable to load the conversation report.')
    return data
  },
}
