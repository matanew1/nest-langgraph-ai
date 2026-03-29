import { Logger } from '@nestjs/common';
import {
  invokeLlm,
  invokeLlmWithImages,
  streamLlm,
  streamLlmWithImages,
} from '@llm/llm.provider';
import { logPhaseEnd, logPhaseStart, startTimer } from '@utils/pretty-log.util';
import { completeAgentRun } from '../state/agent-transition.util';
import type { AgentState } from '../state/agent.state';
import { buildChatPrompt } from '../prompts/agent.prompts';
import { selectModelForTier } from '@llm/model-router';

const logger = new Logger('Chat');

export async function chatNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();
  logPhaseStart('CHAT', `input="${state.input}"`);

  const prompt = buildChatPrompt(state);
  const model = selectModelForTier('balanced');
  const images =
    state.images && state.images.length > 0 ? state.images : undefined;
  const shouldStream =
    !!state.onToken &&
    (state.streamPhases === undefined || state.streamPhases.includes('chat'));

  let answer: string;
  if (shouldStream) {
    if (!state.onToken) {
      throw new Error('shouldStream is true but state.onToken is undefined');
    }
    const emit = state.onToken;
    let accumulated = '';
    const tokenStream = images
      ? streamLlmWithImages(prompt, images, undefined, undefined, state.sessionId, model)
      : streamLlm(prompt, undefined, undefined, state.sessionId, model);
    for await (const token of tokenStream) {
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
    answer = images
      ? await invokeLlmWithImages(prompt, images, undefined, undefined, state.sessionId, model)
      : await invokeLlm(prompt, undefined, undefined, state.sessionId, model);
  }

  logger.debug(`Chat response length: ${answer.length}`);

  logPhaseEnd('CHAT', 'COMPLETE', elapsed());
  return completeAgentRun(answer.trim());
}
