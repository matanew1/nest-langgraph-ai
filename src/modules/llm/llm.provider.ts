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
 * Invoke the LLM with a hard timeout and retry logic.
 * Throws an Error if the call takes longer than `timeoutMs` milliseconds,
 * preventing the agent graph from hanging indefinitely on network issues.
 */
export async function invokeLlm(
  prompt: string,
  timeoutMs: number = env.mistralTimeoutMs,
  maxRetries: number = env.agentMaxRetries,
): Promise<string> {
  const effectiveTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000;
  const retryLimit =
    Number.isInteger(maxRetries) && maxRetries >= 0 ? maxRetries : 0;
  let attempt = 0;
  let lastError: Error | undefined;

  while (attempt <= retryLimit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);

    try {
      if (attempt > 0) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
        logger.warn(
          `Retrying LLM call (attempt ${attempt}/${retryLimit}) after ${backoffMs}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }

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
      lastError = err instanceof Error ? err : new Error(String(err));

      if (controller.signal.aborted) {
        logger.error(
          `LLM call timed out after ${effectiveTimeoutMs}ms (attempt ${attempt + 1}/${retryLimit + 1})`,
        );
      } else {
        logger.error(
          `LLM call failed: ${lastError.message} (attempt ${attempt + 1}/${retryLimit + 1})`,
        );
      }

      // Don't retry if it's a fatal error (e.g., authentication, invalid request)
      if (
        lastError.message.includes('401') ||
        lastError.message.includes('400')
      ) {
        throw lastError;
      }

      attempt++;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error('LLM invocation failed after maximum retries');
}
