import { AgentState } from '../state/agent.state';
import { logPhaseStart, logPhaseEnd, startTimer } from '@utils/pretty-log.util';
import { AGENT_PHASES } from '../state/agent-phase';
import { completeAgentRun } from '../state/agent-transition.util';

export async function clarificationNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();
  logPhaseStart('CLARIFICATION', 'Seeking clarification from the user');

  const lastError = state.errors?.[state.errors.length - 1];
  let clarificationMessage =
    'The agent needs more information to proceed. Please rephrase your request or provide additional details.';

  if (
    lastError &&
    lastError.atPhase === AGENT_PHASES.SUPERVISOR &&
    lastError.details &&
    Array.isArray(lastError.details.missing_capabilities)
  ) {
    clarificationMessage = `The agent cannot fulfill your request because it is missing the following capabilities: ${lastError.details.missing_capabilities.join(", ")}. Please adjust your prompt to align with the agent's abilities or provide more context.`;
  } else if (lastError) {
    clarificationMessage = `The agent encountered an issue during the '${lastError.atPhase}' phase: ${lastError.message}. Could you please provide more details or rephrase your request?`;
  }

  logPhaseEnd('CLARIFICATION', 'Generated clarification message', elapsed());

  return completeAgentRun(clarificationMessage, { errors: [] });
}
