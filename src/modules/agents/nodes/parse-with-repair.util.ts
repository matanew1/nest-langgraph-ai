import { Logger } from '@nestjs/common';
import type { ZodType } from 'zod';
import { invokeLlm } from '@llm/llm.provider';
import { parseStructuredNodeOutput } from './structured-output.util';

const logger = new Logger('ParseWithRepair');

/** Timeout for the repair LLM call (shorter than normal to avoid stalling). */
const REPAIR_TIMEOUT_MS = 10_000;

/**
 * Try to extract a JSON object from raw text using a regex before calling LLM.
 * Returns null if no JSON-like structure is found.
 */
function tryRegexJsonExtract(raw: string): string | null {
  const match = raw.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

export async function parseWithRepair<T>(
  raw: string,
  schema: ZodType<T>,
  schemaDescription: string,
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
    const repaired = await invokeLlm(repairPrompt, REPAIR_TIMEOUT_MS, 0);
    // Throws on double failure — caught by safeNodeHandler → failAgentRun
    return parseStructuredNodeOutput(repaired, schema);
  }
}
