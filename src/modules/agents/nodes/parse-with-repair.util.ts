import { Logger } from '@nestjs/common';
import type { ZodType } from 'zod';
import { invokeLlm } from '@llm/llm.provider';
import { selectModelForTier } from '@llm/model-router';
import { parseStructuredNodeOutput } from './structured-output.util';

const logger = new Logger('ParseWithRepair');

/** Timeout for the repair LLM call (shorter than normal to avoid stalling). */
const REPAIR_TIMEOUT_MS = 10_000;

/**
 * Extract the first balanced JSON object from raw text.
 * Handles strings, escaped characters, and nested objects correctly.
 * More reliable than a greedy regex which matches from first '{' to last '}'.
 */
function tryRegexJsonExtract(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

export async function parseWithRepair<T>(
  raw: string,
  schema: ZodType<T>,
  schemaDescription: string,
  sessionId?: string,
): Promise<T> {
  try {
    return parseStructuredNodeOutput(raw, schema);
  } catch {
    // Fast path: try regex-based JSON extraction before calling LLM
    const extracted = tryRegexJsonExtract(raw);
    if (extracted) {
      try {
        return parseStructuredNodeOutput(extracted, schema);
      } catch {
        // fall through to LLM repair
      }
    }

    logger.warn('Initial JSON parse failed — attempting inline LLM repair');
    const repairPrompt = [
      'You are a JSON repair utility.',
      'Return ONLY a single valid JSON object matching the schema. No prose, no markdown.',
      '',
      `Schema: ${schemaDescription}`,
      '',
      'Invalid input to repair:',
      raw,
    ].join('\n');
    const repaired = await invokeLlm(
      repairPrompt,
      REPAIR_TIMEOUT_MS,
      0,
      sessionId,
      selectModelForTier('fast'),
    );
    // Throws on double failure — caught by safeNodeHandler → failAgentRun
    return parseStructuredNodeOutput(repaired, schema);
  }
}
