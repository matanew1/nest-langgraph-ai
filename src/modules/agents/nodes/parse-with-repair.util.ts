import { Logger } from '@nestjs/common';
import type { ZodType } from 'zod';
import { invokeLlm } from '@llm/llm.provider';
import { parseStructuredNodeOutput } from './structured-output.util';

const logger = new Logger('ParseWithRepair');

export async function parseWithRepair<T>(
  raw: string,
  schema: ZodType<T>,
  schemaDescription: string,
): Promise<T> {
  try {
    return parseStructuredNodeOutput(raw, schema);
  } catch {
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
    const repaired = await invokeLlm(repairPrompt);
    // Throws on double failure — caught by safeNodeHandler → failAgentRun
    return parseStructuredNodeOutput(repaired, schema);
  }
}
