import { ChatMistralAI } from '@langchain/mistralai';
import { HumanMessage } from '@langchain/core/messages';
import { Logger } from '@nestjs/common';
import { env } from '@config/env';
import { CIRCUIT_BREAKER_CONFIG } from '@graph/agent.config';

const logger = new Logger('LlmProvider');

export const llm = new ChatMistralAI({
  apiKey: env.mistralKey,
  model: env.mistralModel,
  temperature: 0,
});

/* ------------------------------------------------------------------ */
/*  Circuit breaker — prevents wasted retries when LLM is down        */
/*  Per-session scoped so one bad session can't block all others.      */
/* ------------------------------------------------------------------ */
const CIRCUIT_BREAKER_THRESHOLD = CIRCUIT_BREAKER_CONFIG.threshold;
const CIRCUIT_BREAKER_COOLDOWN_MS = CIRCUIT_BREAKER_CONFIG.cooldownMs;
/** Stale session breakers are cleaned up after this interval. */
const CIRCUIT_BREAKER_CLEANUP_MS = CIRCUIT_BREAKER_CONFIG.cleanupMs;

interface CircuitBreakerState {
  consecutiveFailures: number;
  openUntil: number;
  lastActivity: number;
}

function createCircuitBreakerState(): CircuitBreakerState {
  return { consecutiveFailures: 0, openUntil: 0, lastActivity: Date.now() };
}

/** Global fallback breaker — trips only when the LLM API is truly unreachable. */
const globalBreaker = createCircuitBreakerState();

/** Per-session breakers keyed by sessionId. */
const sessionBreakers = new Map<string, CircuitBreakerState>();

let lastCleanup = Date.now();

function cleanupStaleBreakers(): void {
  const now = Date.now();
  if (now - lastCleanup < CIRCUIT_BREAKER_CLEANUP_MS) return;
  lastCleanup = now;
  for (const [key, state] of sessionBreakers) {
    if (now - state.lastActivity > CIRCUIT_BREAKER_CLEANUP_MS) {
      sessionBreakers.delete(key);
    }
  }
}

function getBreaker(sessionId?: string): CircuitBreakerState {
  cleanupStaleBreakers();
  if (!sessionId) return globalBreaker;
  let breaker = sessionBreakers.get(sessionId);
  if (!breaker) {
    breaker = createCircuitBreakerState();
    sessionBreakers.set(sessionId, breaker);
  }
  breaker.lastActivity = Date.now();
  return breaker;
}

/** Exported for testing only. */
export function resetCircuitBreaker(sessionId?: string): void {
  if (sessionId) {
    sessionBreakers.delete(sessionId);
  } else {
    globalBreaker.consecutiveFailures = 0;
    globalBreaker.openUntil = 0;
    sessionBreakers.clear();
  }
}

function checkCircuitBreaker(sessionId?: string): void {
  const breaker = getBreaker(sessionId);
  if (
    breaker.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD &&
    Date.now() < breaker.openUntil
  ) {
    throw new Error(
      `LLM circuit breaker open — ${breaker.consecutiveFailures} consecutive failures. ` +
        `Will retry after ${new Date(breaker.openUntil).toISOString()}.`,
    );
  }
}

function recordLlmSuccess(sessionId?: string): void {
  const breaker = getBreaker(sessionId);
  breaker.consecutiveFailures = 0;
  breaker.openUntil = 0;
}

function recordLlmFailure(sessionId?: string): void {
  const breaker = getBreaker(sessionId);
  breaker.consecutiveFailures++;
  if (breaker.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    breaker.openUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
    logger.warn(
      `LLM circuit breaker OPEN after ${breaker.consecutiveFailures} failures — ` +
        `cooldown until ${new Date(breaker.openUntil).toISOString()}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Shared helpers — extracted from duplicated logic across 4 funcs    */
/* ------------------------------------------------------------------ */

/** Extract string content from LangChain message content (string | array | other). */
function extractContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        typeof c === 'string' ? c : ((c as { text?: string }).text ?? ''),
      )
      .join('');
  }
  return String(content);
}

/** Check if an error is fatal and should NOT be retried (auth/bad request). */
function isFatalLlmError(err: Error): boolean {
  const msg = err.message;
  // Check for HTTP status codes in various error formats
  return (
    /\b401\b/.test(msg) ||
    /\b400\b/.test(msg) ||
    /\bUnauthorized\b/i.test(msg) ||
    /\bForbidden\b/i.test(msg)
  );
}

/** Compute backoff delay with jitter to desynchronize concurrent retries. */
function backoffWithJitter(attempt: number): number {
  const base = Math.min(1000 * Math.pow(2, attempt), 10000);
  return base + Math.random() * 500;
}

interface RetryOpts {
  timeoutMs: number;
  maxRetries: number;
  sessionId?: string;
  label: string;
}

function resolveOpts(
  timeoutMs: number,
  maxRetries: number,
  sessionId?: string,
  label = 'LLM',
): RetryOpts {
  return {
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000,
    maxRetries:
      Number.isInteger(maxRetries) && maxRetries >= 0 ? maxRetries : 0,
    sessionId,
    label,
  };
}

/**
 * Execute an async operation with retry, timeout, and circuit breaker.
 * Used by both invoke and image-invoke paths.
 */
async function withRetryAndTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts: RetryOpts,
): Promise<T> {
  checkCircuitBreaker(opts.sessionId);

  let attempt = 0;
  let lastError: Error | undefined;

  while (attempt <= opts.maxRetries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

    try {
      if (attempt > 0) {
        const backoffMs = backoffWithJitter(attempt);
        logger.warn(
          `Retrying ${opts.label} (attempt ${attempt}/${opts.maxRetries}) after ${Math.round(backoffMs)}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }

      const result = await fn(controller.signal);
      recordLlmSuccess(opts.sessionId);
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (controller.signal.aborted) {
        logger.error(
          `${opts.label} timed out after ${opts.timeoutMs}ms (attempt ${attempt + 1}/${opts.maxRetries + 1})`,
        );
      } else {
        logger.error(
          `${opts.label} failed: ${lastError.message} (attempt ${attempt + 1}/${opts.maxRetries + 1})`,
        );
      }

      if (isFatalLlmError(lastError)) throw lastError;

      recordLlmFailure(opts.sessionId);
      attempt++;
    } finally {
      clearTimeout(timer);
    }
  }

  throw (
    lastError ||
    new Error(
      `${opts.label} failed after ${opts.maxRetries + 1} attempts (timeout=${opts.timeoutMs}ms)`,
    )
  );
}

/**
 * Execute a streaming operation with retry, timeout, and circuit breaker.
 * Yields tokens as they arrive. Used by both stream and image-stream paths.
 */
async function* withStreamRetryAndTimeout(
  fn: (signal: AbortSignal) => Promise<AsyncIterable<{ content: unknown }>>,
  opts: RetryOpts,
): AsyncGenerator<string> {
  checkCircuitBreaker(opts.sessionId);

  let attempt = 0;
  let lastError: Error | undefined;

  while (attempt <= opts.maxRetries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

    try {
      if (attempt > 0) {
        const backoffMs = backoffWithJitter(attempt);
        logger.warn(
          `Retrying ${opts.label} (attempt ${attempt}/${opts.maxRetries}) after ${Math.round(backoffMs)}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }

      const stream = await fn(controller.signal);
      for await (const chunk of stream) {
        yield extractContent(chunk.content);
      }

      recordLlmSuccess(opts.sessionId);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (controller.signal.aborted) {
        logger.error(
          `${opts.label} timed out after ${opts.timeoutMs}ms (attempt ${attempt + 1}/${opts.maxRetries + 1})`,
        );
      } else {
        logger.error(
          `${opts.label} failed: ${lastError.message} (attempt ${attempt + 1}/${opts.maxRetries + 1})`,
        );
      }

      if (isFatalLlmError(lastError)) throw lastError;

      recordLlmFailure(opts.sessionId);
      attempt++;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  throw (
    lastError ||
    new Error(
      `${opts.label} failed after ${opts.maxRetries + 1} attempts (timeout=${opts.timeoutMs}ms)`,
    )
  );
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Invoke the LLM with a hard timeout, retry logic, and circuit breaker.
 */
export async function invokeLlm(
  prompt: string,
  timeoutMs: number = env.mistralTimeoutMs,
  maxRetries: number = env.agentMaxRetries,
  sessionId?: string,
): Promise<string> {
  const opts = resolveOpts(timeoutMs, maxRetries, sessionId, 'LLM call');
  return withRetryAndTimeout(
    async (signal) =>
      extractContent((await llm.invoke(prompt, { signal })).content),
    opts,
  );
}

/**
 * Stream the LLM response as an async generator, yielding each chunk's content.
 */
export async function* streamLlm(
  prompt: string,
  timeoutMs: number = env.mistralTimeoutMs,
  maxRetries: number = env.agentMaxRetries,
  sessionId?: string,
): AsyncGenerator<string> {
  const opts = resolveOpts(timeoutMs, maxRetries, sessionId, 'LLM stream');
  yield* withStreamRetryAndTimeout(
    (signal) => llm.stream(prompt, { signal }),
    opts,
  );
}

/** Build a HumanMessage with text + image URLs for vision models. */
function buildVisionMessage(
  prompt: string,
  images: Array<{ url: string }>,
): HumanMessage {
  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  > = [
    { type: 'text', text: prompt },
    ...images.map((img) => ({
      type: 'image_url' as const,
      image_url: { url: img.url },
    })),
  ];
  return new HumanMessage({ content: content as any });
}

/**
 * Invoke the LLM with text + images (vision model).
 */
export async function invokeLlmWithImages(
  prompt: string,
  images: Array<{ url: string }>,
  timeoutMs: number = env.mistralTimeoutMs,
  maxRetries: number = env.agentMaxRetries,
  sessionId?: string,
): Promise<string> {
  const opts = resolveOpts(timeoutMs, maxRetries, sessionId, 'Vision LLM call');
  const message = buildVisionMessage(prompt, images);
  return withRetryAndTimeout(
    async (signal) =>
      extractContent((await llm.invoke([message], { signal })).content),
    opts,
  );
}

/**
 * Stream the LLM response with text + images, yielding each chunk.
 */
export async function* streamLlmWithImages(
  prompt: string,
  images: Array<{ url: string }>,
  timeoutMs: number = env.mistralTimeoutMs,
  maxRetries: number = env.agentMaxRetries,
  sessionId?: string,
): AsyncGenerator<string> {
  const opts = resolveOpts(
    timeoutMs,
    maxRetries,
    sessionId,
    'Vision LLM stream',
  );
  const message = buildVisionMessage(prompt, images);
  yield* withStreamRetryAndTimeout(
    (signal) => llm.stream([message], { signal }),
    opts,
  );
}
