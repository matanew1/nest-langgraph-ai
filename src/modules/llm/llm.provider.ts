import { ChatMistralAI } from "@langchain/mistralai";
import { Logger } from '@nestjs/common';
import { env } from '@config/env';

const logger = new Logger('LlmProvider');

export const llm = new ChatMistralAI({
  apiKey: process.env.MISTRAL_API_KEY,
  model: "mistral-large-latest",
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
    return res.content as string;
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
