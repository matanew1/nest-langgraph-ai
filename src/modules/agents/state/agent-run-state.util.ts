import { AGENT_PHASES } from './agent-phase';
import { DEFAULT_AGENT_COUNTERS } from './agent-state.helpers';
import type { AgentState, ImageAttachment } from './agent.state';

interface InitialAgentRunStateOptions {
  sessionMemory?: string;
  sessionId?: string;
  onToken?: (token: string) => void;
  streamPhases?: string[];
  images?: ImageAttachment[];
}

export function createInitialAgentRunState(
  prompt: string,
  options: InitialAgentRunStateOptions = {},
): Partial<AgentState> {
  return {
    input: prompt,
    phase: AGENT_PHASES.SUPERVISOR,
    sessionId: options.sessionId,
    currentStep: 0,
    plan: [],
    objective: undefined,
    reviewRequest: undefined,
    expectedResult: undefined,
    selectedTool: undefined,
    toolParams: undefined,
    toolResultRaw: undefined,
    toolResult: undefined,
    criticDecision: undefined,
    finalAnswer: undefined,
    projectContext: undefined,
    memoryContext: undefined,
    sessionMemory: options.sessionMemory,
    onToken: options.onToken,
    streamPhases: options.streamPhases,
    images: options.images,
    attempts: [],
    counters: { ...DEFAULT_AGENT_COUNTERS },
    errors: [],
  };
}
