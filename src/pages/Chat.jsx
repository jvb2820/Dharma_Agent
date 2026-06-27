import ChatInput from '../components/chat/ChatInput'
import ChatWindow from '../components/chat/ChatWindow'

function Chat() {
  return (
    <section className="page sales-chat-page">
      <div className="sales-chat-shell">
        <header className="sales-chat-header">
          <div>
            <p className="eyebrow">Sales Agent</p>
            <h1>Maria</h1>
          </div>
          <span className="status-pill">Ready</span>
        </header>
        <ChatWindow />
        <ChatInput />
      </div>
    </section>
  )
}

export default Chat
