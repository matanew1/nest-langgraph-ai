import { AGENT_PHASES } from './agent-phase';
import { DEFAULT_AGENT_COUNTERS } from './agent-state.helpers';
import type { AgentState } from './agent.state';

export function createInitialAgentRunState(
  prompt: string,
  previous?: Partial<AgentState>,
): Partial<AgentState> {
  return {
    input: prompt,
    phase: AGENT_PHASES.SUPERVISOR,
    currentStep: 0,
    plan: [],
    objective: undefined,
    expectedResult: undefined,
    selectedTool: undefined,
    toolParams: undefined,
    toolResultRaw: undefined,
    toolResult: undefined,
    criticDecision: undefined,
    jsonRepair: undefined,
    jsonRepairResult: undefined,
    finalAnswer: undefined,
    projectContext: previous?.projectContext,
    attempts: previous?.attempts ?? [],
    counters: { ...DEFAULT_AGENT_COUNTERS },
    errors: [],
  };
}
