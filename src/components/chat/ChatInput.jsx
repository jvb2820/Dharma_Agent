import { useState } from 'react'
import { useChat } from '../../hooks/useChat'

function ChatInput() {
  const { isSending, resetConversation, sendMessage } = useChat()
  const [draft, setDraft] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()

    const message = draft.trim()

    if (!message) {
      return
    }

    setDraft('')
    await sendMessage(message)
  }

  return (
    <form className="panel chat-input" onSubmit={handleSubmit}>
      <input
        type="text"
        value={draft}
        placeholder="Ask as a lead: I want to lose weight but I am nervous about injections..."
        disabled={isSending}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type="button" disabled={isSending} onClick={resetConversation}>
        Reset
      </button>
      <button type="submit" disabled={isSending || !draft.trim()}>
        {isSending ? 'Sending' : 'Send'}
      </button>
    </form>
  )
}

export default ChatInput
