import { useAgent } from '../../hooks/useAgent'

function AgentSelector() {
  const { activeAgent, agents, setActiveAgent } = useAgent()

  return (
    <aside className="panel agent-selector">
      <h2>Agent Switcher</h2>
      {agents.map((agent) => (
        <button
          key={agent.id}
          type="button"
          className={agent.id === activeAgent.id ? 'active' : ''}
          onClick={() => setActiveAgent(agent)}
        >
          {agent.label}
        </button>
      ))}
      <div className="agent-profile">
        <strong>{activeAgent.name || activeAgent.label}</strong>
        {activeAgent.goal ? <p>{activeAgent.goal}</p> : null}
      </div>
    </aside>
  )
}

export default AgentSelector
