function MessageBubble({ role = 'user', message = '' }) {
  return (
    <article className={`message-bubble message-bubble-${role}`}>
      <span>{message}</span>
    </article>
  )
}

export default MessageBubble
