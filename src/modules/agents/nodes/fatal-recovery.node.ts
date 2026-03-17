import { Logger } from '@nestjs/common';
import { AgentState } from '../state/agent.state';
import { logPhaseStart, logPhaseEnd, startTimer } from '@utils/pretty-log.util';
import { completeAgentRun } from '../state/agent-transition.util';

const logger = new Logger('FatalRecovery');

export async function fatalRecoveryNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();
  logPhaseStart('FATAL_RECOVERY', 'Attempting to recover from a fatal error');

  const lastError = state.errors?.[state.errors.length - 1];
  let finalAnswer =
    'An unexpected fatal error occurred. The agent could not complete the task.';

  if (lastError) {
    finalAnswer = `The agent encountered a critical error during the '${lastError.atPhase}' phase: ${lastError.message}. Please try rephrasing your prompt or contact support if the issue persists.`;
    logger.error(`Fatal error details: ${JSON.stringify(lastError)}`);
  }

  logPhaseEnd(
    'FATAL_RECOVERY',
    'Providing a graceful fallback response',
    elapsed(),
  );

  return completeAgentRun(finalAnswer, { errors: [] });
}
