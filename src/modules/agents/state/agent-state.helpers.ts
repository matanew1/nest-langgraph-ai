import type { AgentCounters } from './agent.state';

export const DEFAULT_AGENT_COUNTERS: AgentCounters = {
  turn: 0,
  toolCalls: 0,
  replans: 0,
  stepRetries: 0,
  supervisorFallbacks: 0,
};

export function getAgentCounters(
  counters?: Partial<AgentCounters>,
): AgentCounters {
  return {
    ...DEFAULT_AGENT_COUNTERS,
    ...(counters ?? {}),
  };
}

export function incrementAgentCounters(
  counters: Partial<AgentCounters> | undefined,
  delta: Partial<AgentCounters>,
): AgentCounters {
  const current = getAgentCounters(counters);

  return {
    turn: current.turn + (delta.turn ?? 0),
    toolCalls: current.toolCalls + (delta.toolCalls ?? 0),
    replans: current.replans + (delta.replans ?? 0),
    stepRetries: current.stepRetries + (delta.stepRetries ?? 0),
    supervisorFallbacks:
      current.supervisorFallbacks + (delta.supervisorFallbacks ?? 0),
  };
}
