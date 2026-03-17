import { Logger } from '@nestjs/common';
import { invokeLlm } from '@llm/llm.provider';
import { logPhaseEnd, logPhaseStart, startTimer } from '@utils/pretty-log.util';
import { completeAgentRun } from '../state/agent-transition.util';
import type { AgentState } from '../state/agent.state';
import { buildChatPrompt } from '../prompts/agent.prompts';

const logger = new Logger('Chat');

export async function chatNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();
  logPhaseStart('CHAT', `input="${state.input}"`);

  const answer = await invokeLlm(buildChatPrompt(state));
  logger.debug(`Chat response length: ${answer.length}`);

  logPhaseEnd('CHAT', 'COMPLETE', elapsed());
  return completeAgentRun(answer.trim());
}
