export const memoryService = {
  listSuggestions: async () => {
    const response = await fetch('/api/memory/suggestions')
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Unable to load memory suggestions.')
    }

    return data.suggestions || []
  },

  createMemory: async ({ category, content, agentId = 'sales' }) => {
    const response = await fetch('/api/memory', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ agentId, category, content }),
    })
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Unable to save memory.')
    }

    return data.memory
  },

  approveSuggestion: async (id) => {
    const response = await fetch(`/api/memory/suggestions/${id}/approve`, {
      method: 'POST',
    })
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Unable to approve memory suggestion.')
    }

    return data.memory
  },

  rejectSuggestion: async (id) => {
    const response = await fetch(`/api/memory/suggestions/${id}/reject`, {
      method: 'POST',
    })
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Unable to reject memory suggestion.')
    }

    return data.suggestion
  },
}
