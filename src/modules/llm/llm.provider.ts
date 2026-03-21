import { ChatMistralAI } from '@langchain/mistralai';
import { Logger } from '@nestjs/common';
import { env } from '@config/env';

const logger = new Logger('LlmProvider');

export const llm = new ChatMistralAI({
  apiKey: env.mistralKey,
  model: env.mistralModel,
  temperature: 0,
});

/* ------------------------------------------------------------------ */
/*  Circuit breaker — prevents wasted retries when LLM is down        */
/* ------------------------------------------------------------------ */
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

const circuitBreaker = {
  consecutiveFailures: 0,
  openUntil: 0,
};

/** Exported for testing only. */
export function resetCircuitBreaker(): void {
  circuitBreaker.consecutiveFailures = 0;
  circuitBreaker.openUntil = 0;
}

function checkCircuitBreaker(): void {
  if (
    circuitBreaker.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD &&
    Date.now() < circuitBreaker.openUntil
  ) {
    throw new Error(
      `LLM circuit breaker open — ${circuitBreaker.consecutiveFailures} consecutive failures. ` +
        `Will retry after ${new Date(circuitBreaker.openUntil).toISOString()}.`,
    );
  }
}

function recordLlmSuccess(): void {
  circuitBreaker.consecutiveFailures = 0;
  circuitBreaker.openUntil = 0;
}

function recordLlmFailure(): void {
  circuitBreaker.consecutiveFailures++;
  if (circuitBreaker.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreaker.openUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
    logger.warn(
      `LLM circuit breaker OPEN after ${circuitBreaker.consecutiveFailures} failures — ` +
        `cooldown until ${new Date(circuitBreaker.openUntil).toISOString()}`,
    );
  }
}

/**
 * Invoke the LLM with a hard timeout, retry logic, and circuit breaker.
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
  checkCircuitBreaker();

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

      let result: string;
      if (typeof content === 'string') {
        result = content;
      } else if (Array.isArray(content)) {
        result = content
          .map((c) =>
            typeof c === 'string' ? c : ((c as { text?: string }).text ?? ''),
          )
          .join('');
      } else {
        result = String(content);
      }
      recordLlmSuccess();
      return result;
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

      recordLlmFailure();
      attempt++;
    } finally {
      clearTimeout(timer);
    }
  }

  throw (
    lastError ||
    new Error(
      `LLM invocation failed after ${retryLimit + 1} attempts (timeout=${effectiveTimeoutMs}ms)`,
    )
  );
}

/**
 * Stream the LLM response as an async generator, yielding each chunk's content
 * individually. Uses the same circuit breaker, timeout, and retry logic as
 * `invokeLlm()`.
 */
export async function* streamLlm(
  prompt: string,
  timeoutMs: number = env.mistralTimeoutMs,
  maxRetries: number = env.agentMaxRetries,
): AsyncGenerator<string> {
  const effectiveTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000;
  const retryLimit =
    Number.isInteger(maxRetries) && maxRetries >= 0 ? maxRetries : 0;
  checkCircuitBreaker();

  let attempt = 0;
  let lastError: Error | undefined;

  while (attempt <= retryLimit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);

    try {
      if (attempt > 0) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
        logger.warn(
          `Retrying LLM stream (attempt ${attempt}/${retryLimit}) after ${backoffMs}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }

      const stream = await llm.stream(prompt, { signal: controller.signal });

      for await (const chunk of stream) {
        const content = chunk.content;
        let token: string;
        if (typeof content === 'string') {
          token = content;
        } else if (Array.isArray(content)) {
          token = content
            .map((c) =>
              typeof c === 'string' ? c : ((c as { text?: string }).text ?? ''),
            )
            .join('');
        } else {
          token = String(content);
        }
        yield token;
      }

      recordLlmSuccess();
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (controller.signal.aborted) {
        logger.error(
          `LLM stream timed out after ${effectiveTimeoutMs}ms (attempt ${attempt + 1}/${retryLimit + 1})`,
        );
      } else {
        logger.error(
          `LLM stream failed: ${lastError.message} (attempt ${attempt + 1}/${retryLimit + 1})`,
        );
      }

      // Don't retry if it's a fatal error (e.g., authentication, invalid request)
      if (
        lastError.message.includes('401') ||
        lastError.message.includes('400')
      ) {
        throw lastError;
      }

      recordLlmFailure();
      attempt++;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  throw (
    lastError ||
    new Error(
      `LLM stream failed after ${retryLimit + 1} attempts (timeout=${effectiveTimeoutMs}ms)`,
    )
  );
}
