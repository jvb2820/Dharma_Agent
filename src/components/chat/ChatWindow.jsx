import { useEffect, useRef } from 'react'
import { useChat } from '../../hooks/useChat'
import MessageBubble from './MessageBubble'
import TypingIndicator from './TypingIndicator'

function ChatWindow() {
  const { error, isSending, messages } = useChat()
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, isSending])

  return (
    <section className="panel chat-window" aria-label="Conversation history">
      {messages.map((message) => (
        <MessageBubble key={message.id} role={message.role} message={message.content} />
      ))}
      {isSending ? <TypingIndicator /> : null}
      {error ? <div className="chat-error">{error}</div> : null}
      <div ref={endRef} />
    </section>
  )
}

export default ChatWindow
