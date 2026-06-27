import { AGENT_TYPES } from '../../constants/agents'

function AgentStatus() {
  return (
    <section className="list">
      {AGENT_TYPES.map((agent) => (
        <article className="panel" key={agent.id}>
          <h2>{agent.label}</h2>
          <p>Status placeholder</p>
        </article>
      ))}
    </section>
  )
}

export default AgentStatus
