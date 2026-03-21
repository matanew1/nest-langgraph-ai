import { invokeLlm } from '@llm/llm.provider';
import { Logger } from '@nestjs/common';
import { extractJson } from '@utils/json.util';
import { preview } from '@utils/pretty-log.util';
import type { ZodType } from 'zod';
import type { AgentState } from '../state/agent.state';

export async function getStructuredNodeRawResponse(
  state: AgentState,
  logger: Logger,
  buildPrompt: () => string,
): Promise<string> {
  if (state.jsonRepairResult !== undefined) {
    const raw = state.jsonRepairResult;
    logger.debug(`Using repaired JSON:\n${preview(raw)}`);
    return raw;
  }

  const prompt = buildPrompt();
  const raw = await invokeLlm(prompt);
  logger.debug(`LLM response:\n${preview(raw)}`);
  return raw;
}

export function parseStructuredNodeOutput<T>(
  raw: string,
  schema: ZodType<T>,
): T {
  const parsed = extractJson<unknown>(raw);
  return schema.parse(parsed);
}
