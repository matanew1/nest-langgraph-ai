import { Logger } from '@nestjs/common';
import { invokeLlm } from '@llm/llm.provider';
import { logPhaseEnd, logPhaseStart, startTimer } from '@utils/pretty-log.util';
import { completeAgentRun } from '../state/agent-transition.util';
import type { AgentState } from '../state/agent.state';
import { buildGeneratorPrompt } from '../prompts/agent.prompts';

const logger = new Logger('Generator');

/**
 * Synthesises a user-facing final answer from the completed plan steps.
 * Separates answer generation from the critic's routing judgment.
 */
export async function generatorNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();
  logPhaseStart('GENERATOR', `steps=${state.attempts?.length ?? 0}`);

  const answer = await invokeLlm(buildGeneratorPrompt(state));
  logger.debug(`Generator answer length: ${answer.length}`);

  logPhaseEnd('GENERATOR', 'COMPLETE', elapsed());
  return completeAgentRun(answer.trim());
}
