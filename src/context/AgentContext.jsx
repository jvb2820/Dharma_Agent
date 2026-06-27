import { useMemo, useState } from 'react'
import { AGENT_TYPES } from '../constants/agents'
import { AgentContext } from './agent-context'

export function AgentProvider({ children }) {
  const [activeAgent, setActiveAgent] = useState(AGENT_TYPES[0])

  const value = useMemo(
    () => ({
      activeAgent,
      agents: AGENT_TYPES,
      setActiveAgent,
    }),
    [activeAgent],
  )

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>
}
