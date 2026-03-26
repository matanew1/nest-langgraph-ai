import { Logger } from '@nestjs/common';
import { invokeLlm, streamLlm } from '@llm/llm.provider';
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

  const prompt = buildGeneratorPrompt(state);
  const shouldStream =
    !!state.onToken &&
    (state.streamPhases === undefined ||
      state.streamPhases.includes('generate'));

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

  // If the LLM returned empty content, retry once without streaming
  if (!answer.trim()) {
    logger.warn('Generator produced empty output — retrying once');
    answer = await invokeLlm(prompt);
  }

  // If still empty, synthesize from the last successful attempt
  if (!answer.trim()) {
    logger.warn('Generator retry also empty — synthesizing from attempts');
    const lastResult =
      state.attempts?.at(-1)?.result?.preview ??
      state.toolResultRaw ??
      'The task was completed but no summary could be generated.';
    answer = `[Auto-synthesized] ${lastResult}`;
  }

  logger.debug(`Generator answer length: ${answer.length}`);

  logPhaseEnd('GENERATOR', 'COMPLETE', elapsed());

  return completeAgentRun(answer.trim());
}
