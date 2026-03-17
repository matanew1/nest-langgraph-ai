import { Logger } from '@nestjs/common';
import { invokeLlm } from '@llm/llm.provider';
import { buildCriticPrompt } from '../prompts/agent.prompts';
import {
  prettyJson,
  logPhaseStart,
  logPhaseEnd,
  startTimer,
  preview,
} from '@utils/pretty-log.util';
import { extractJson } from '@utils/json.util';
import { AgentState } from '../state/agent.state';
import { env } from '@config/env';
import { criticDecisionSchema } from '../state/agent.schemas';

const logger = new Logger('Critic');

export async function criticNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();
  const stepNum = (state.currentStep ?? 0) + 1;
  const totalSteps = (state.plan ?? []).length;

  logPhaseStart('CRITIC', `evaluating step ${stepNum}/${totalSteps}`);

  let raw: string;
  if (state.jsonRepairResult !== undefined) {
    raw = state.jsonRepairResult;
    logger.debug(`Using repaired JSON:\n${preview(raw)}`);
  } else {
    const prompt = buildCriticPrompt(state);
    raw = await invokeLlm(prompt);
    logger.debug(`LLM response:\n${preview(raw)}`);
  }

  try {
    const parsed = extractJson<unknown>(raw);
    const decision = criticDecisionSchema.parse(parsed);

    logPhaseEnd('CRITIC', `DECISION: ${decision.decision}`, elapsed());
    return {
      phase: 'route',
      criticDecision: decision,
      jsonRepairResult: undefined,
    };
  } catch (e) {
    logPhaseEnd('CRITIC', 'PARSE FAILED → json_repair', elapsed());
    logger.error(`Raw response: ${preview(raw)}`);
    return {
      phase: 'route',
      jsonRepair: {
        fromPhase: 'judge',
        raw,
        schema:
          '{"decision":"advance|retry_step|replan|complete|fatal","reason":"string","finalAnswer?":"string","suggestedPlanFix?":"string"}',
      },
      errors: [
        {
          code: 'json_invalid',
          message: `Critic JSON invalid: ${e instanceof Error ? e.message : String(e)}`,
          atPhase: 'judge',
        },
      ],
    };
  }
}
