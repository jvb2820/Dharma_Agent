import AgentStatus from '../components/agents/AgentStatus'

function Agents() {
  return (
    <section className="page">
      <header className="page-header">
        <h1>Agents</h1>
        <p>Manage Sales, Support, Nutrition, and Admin agent configuration.</p>
      </header>

      <AgentStatus />
    </section>
  )
}

export default Agents
