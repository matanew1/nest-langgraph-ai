import { Logger } from '@nestjs/common';
import { invokeLlm } from '@providers/llm.provider';
import type { AgentState } from '@state/agent.state';
import { extractJson } from '@utils/json.util';
import { buildCriticPrompt } from '../prompts/agent.prompts';

const logger = new Logger('CriticNode');

export async function criticNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  logger.log(`Evaluating result for: "${state.input}"`);

  const prompt = buildCriticPrompt(state);
  const raw = await invokeLlm(prompt);

  logger.debug(`Raw LLM response:\n${raw}`);

  try {
    const decision = extractJson<{ done: boolean; answer?: string }>(raw);
    logger.log(`Decision → done=${decision.done}`);
    return {
      done: decision.done,
      finalAnswer: decision.answer,
    };
  } catch (error) {
    logger.error(`Failed to parse critic response: ${raw}`);
    return {
      done: false,
      finalAnswer: state.finalAnswer,
    };
  }
}
