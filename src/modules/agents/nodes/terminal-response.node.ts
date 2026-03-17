import { logPhaseEnd, logPhaseStart, startTimer } from '@utils/pretty-log.util';
import { AGENT_PHASES } from '../state/agent-phase';
import { completeAgentRun } from '../state/agent-transition.util';
import { AgentState } from '../state/agent.state';

function buildClarificationMessage(state: AgentState): string {
  const lastError = state.errors?.[state.errors.length - 1];
  if (
    lastError &&
    lastError.atPhase === AGENT_PHASES.SUPERVISOR &&
    lastError.details &&
    Array.isArray(lastError.details.missing_capabilities)
  ) {
    return `The agent cannot fulfill your request because it is missing the following capabilities: ${lastError.details.missing_capabilities.join(', ')}. Please adjust your prompt to align with the agent's abilities or provide more context.`;
  }

  if (lastError) {
    return `The agent encountered an issue during the '${lastError.atPhase}' phase: ${lastError.message}. Could you please provide more details or rephrase your request?`;
  }

  return 'The agent needs more information to proceed. Please rephrase your request or provide additional details.';
}

function buildFatalMessage(state: AgentState): string {
  const lastError = state.errors?.[state.errors.length - 1];
  if (!lastError) {
    return 'An unexpected fatal error occurred. The agent could not complete the task.';
  }

  return `The agent encountered a critical error during the '${lastError.atPhase}' phase: ${lastError.message}. Please try rephrasing your prompt or contact support if the issue persists.`;
}

export async function terminalResponseNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();
  const mode =
    state.phase === AGENT_PHASES.CLARIFICATION
      ? 'CLARIFICATION'
      : 'FATAL_RECOVERY';

  logPhaseStart(mode, 'Preparing terminal response');

  const finalAnswer =
    state.phase === AGENT_PHASES.CLARIFICATION
      ? buildClarificationMessage(state)
      : buildFatalMessage(state);

  logPhaseEnd(mode, 'Prepared terminal response', elapsed());
  return completeAgentRun(finalAnswer, { errors: [] });
}
