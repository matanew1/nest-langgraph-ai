import { Logger } from '@nestjs/common';
import { invokeLlm, streamLlm } from '@llm/llm.provider';
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

  const prompt = buildChatPrompt(state);
  const shouldStream =
    !!state.onToken &&
    (state.streamPhases === undefined || state.streamPhases.includes('chat'));

  let answer: string;
  if (shouldStream) {
    const emit = state.onToken!;
    let accumulated = '';
    for await (const token of streamLlm(prompt)) {
      if (token) {
        emit(token);
        accumulated += token;
      }
    }
    if (!accumulated) {
      logger.warn('streamLlm yielded no content');
    }
    answer = accumulated;
  } else {
    answer = await invokeLlm(prompt);
  }

  logger.debug(`Chat response length: ${answer.length}`);

  logPhaseEnd('CHAT', 'COMPLETE', elapsed());
  return completeAgentRun(answer.trim());
}
