import { invokeLlm, invokeLlmWithImages } from '@llm/llm.provider';
import { Logger } from '@nestjs/common';
import { extractJson } from '@utils/json.util';
import { preview } from '@utils/pretty-log.util';
import type { ZodType } from 'zod';
import type { AgentState, ImageAttachment } from '../state/agent.state';

export async function getStructuredNodeRawResponse(
  state: AgentState,
  logger: Logger,
  buildPrompt: () => string,
  images?: ImageAttachment[],
  model?: string,
): Promise<string> {
  const prompt = buildPrompt();
  const raw =
    images && images.length > 0
      ? await invokeLlmWithImages(
          prompt,
          images,
          undefined,
          undefined,
          state.sessionId,
          model,
        )
      : await invokeLlm(prompt, undefined, undefined, state.sessionId, model);
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
