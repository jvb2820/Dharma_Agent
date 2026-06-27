function TypingIndicator() {
  return (
    <div className="typing-indicator" aria-label="Agent is typing">
      <span>Typing</span>
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="typing-dot" />
    </div>
  )
}

export default TypingIndicator
