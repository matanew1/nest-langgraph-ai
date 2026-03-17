import { ChatMistralAI } from '@langchain/mistralai';
import { Logger } from '@nestjs/common';
import { env } from '@config/env';

const logger = new Logger('LlmProvider');

export const llm = new ChatMistralAI({
  apiKey: env.mistralKey,
  model: env.mistralModel,
  temperature: 0,
});

/**
 * Invoke the LLM with a hard timeout.
 * Throws an Error if the call takes longer than `timeoutMs` milliseconds,
 * preventing the agent graph from hanging indefinitely on network issues.
 */
export async function invokeLlm(
  prompt: string,
  timeoutMs: number = env.mistralTimeoutMs,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await llm.invoke(prompt, { signal: controller.signal });
    const content = res.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((c) =>
          typeof c === 'string' ? c : ((c as { text?: string }).text ?? ''),
        )
        .join('');
    }
    return String(content);
  } catch (err) {
    if (controller.signal.aborted) {
      logger.error(`LLM call timed out after ${timeoutMs}ms`);
      throw new Error(`LLM call timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
