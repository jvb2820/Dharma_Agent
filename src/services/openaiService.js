const OPENAI_MODEL = import.meta.env.VITE_OPENAI_MODEL || 'gpt-4.1-mini'

export const openaiService = {
  createResponse: async ({ messages, instructions, context, agent, customerLanguage } = {}) => {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        instructions,
        context,
        agent,
        customerLanguage,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Unable to create OpenAI response.')
    }

    return data
  },
}
