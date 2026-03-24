import { Logger } from '@nestjs/common';
import { Send } from '@langchain/langgraph';
import { invokeLlm, streamLlm } from '@llm/llm.provider';
import { logPhaseEnd, logPhaseStart, startTimer } from '@utils/pretty-log.util';
import { completeAgentRun } from '../state/agent-transition.util';
import type { AgentState } from '../state/agent.state';
import { buildGeneratorPrompt } from '../prompts/agent.prompts';
import { AGENT_GRAPH_NODES } from '../graph/agent-topology';

const logger = new Logger('Generator');

/**
 * Synthesises a user-facing final answer from the completed plan steps.
 * Separates answer generation from the critic's routing judgment.
 */
export async function generatorNode(state: AgentState): Promise<[Send, Send]> {
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

  logger.debug(`Generator answer length: ${answer.length}`);

  logPhaseEnd('GENERATOR', 'COMPLETE', elapsed());

  const finalState = { ...state, ...completeAgentRun(answer.trim()) };
  return [
    new Send(AGENT_GRAPH_NODES.ROUTER, finalState),
    new Send(AGENT_GRAPH_NODES.MEMORY_PERSIST, finalState),
  ];
}
