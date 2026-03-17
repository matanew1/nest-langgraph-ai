import { Logger } from '@nestjs/common';
import { invokeLlm } from '@llm/llm.provider';
import { extractJson } from '@utils/json.util';
import type { AgentState } from '../state/agent.state';
import {
  logPhaseEnd,
  logPhaseStart,
  startTimer,
  preview,
} from '@utils/pretty-log.util';

const logger = new Logger('JsonRepair');

function unwrapRepaired(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const obj = parsed as Record<string, unknown>;
  // Accept both formats:
  // 1) {"repaired": <object matching schema>}
  // 2) <object matching schema>
  return Object.prototype.hasOwnProperty.call(obj, 'repaired')
    ? obj.repaired
    : parsed;
}

/**
 * Repairs invalid JSON produced by an LLM node.
 *
 * The originating node provides `state.jsonRepair` containing:
 * - the raw invalid output
 * - a compact schema description to enforce
 */
export async function jsonRepairNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();
  const req = state.jsonRepair;
  if (!req) return {};

  logPhaseStart(
    'JSON_REPAIR',
    `from=${req.fromPhase} | raw="${preview(req.raw)}"`,
  );

  const prompt = [
    'You are a JSON repair utility.',
    'Return ONLY a single JSON object that matches the given schema. No prose, no markdown, no code fences.',
    '',
    'Schema (must match exactly, no extra keys):',
    req.schema,
    '',
    'Invalid output to repair:',
    req.raw,
    '',
    'Return ONLY the repaired JSON object that matches the schema.',
    'If you choose to wrap it, the ONLY allowed wrapper is: {"repaired": <object matching schema>}',
  ].join('\n');

  const raw = await invokeLlm(prompt);
  logger.debug(`LLM response:\n${preview(raw)}`);

  try {
    const parsed = extractJson<unknown>(raw);
    const repaired = unwrapRepaired(parsed);
    const repairedStr = JSON.stringify(repaired);
    logPhaseEnd('JSON_REPAIR', 'OK', elapsed());
    return {
      jsonRepairResult: repairedStr,
      jsonRepairFromPhase: req.fromPhase,
      jsonRepair: undefined,
    };
  } catch (e) {
    logPhaseEnd('JSON_REPAIR', 'FAILED', elapsed());
    const msg = e instanceof Error ? e.message : String(e);
    return {
      jsonRepairResult: undefined,
      jsonRepair: undefined,
      phase: 'fatal',
      finalAnswer: `Failed to repair invalid JSON: ${msg}`,
      errors: [
        {
          code: 'json_invalid',
          message: `JSON repair failed: ${msg}`,
          atPhase: 'fatal',
        },
      ],
    };
  }
}
