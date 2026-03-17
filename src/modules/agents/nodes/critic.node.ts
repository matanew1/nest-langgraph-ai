import { Logger } from '@nestjs/common';
import { buildCriticPrompt } from '../prompts/agent.prompts';
import {
  logPhaseStart,
  logPhaseEnd,
  startTimer,
  preview,
} from '@utils/pretty-log.util';
import { AgentState } from '../state/agent.state';
import { criticDecisionSchema } from '../state/agent.schemas';
import {
  buildJsonRepairState,
  getStructuredNodeRawResponse,
  parseStructuredNodeOutput,
} from './structured-output.util';

const logger = new Logger('Critic');

export async function criticNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();
  const stepNum = (state.currentStep ?? 0) + 1;
  const totalSteps = (state.plan ?? []).length;

  logPhaseStart('CRITIC', `evaluating step ${stepNum}/${totalSteps}`);

  const raw = await getStructuredNodeRawResponse(state, logger, () =>
    buildCriticPrompt(state),
  );

  try {
    const decision = parseStructuredNodeOutput(raw, criticDecisionSchema);

    logPhaseEnd('CRITIC', `DECISION: ${decision.decision}`, elapsed());
    return {
      phase: 'route',
      criticDecision: decision,
      jsonRepairResult: undefined,
    };
  } catch (e) {
    logPhaseEnd('CRITIC', 'PARSE FAILED → json_repair', elapsed());
    logger.error(`Raw response: ${preview(raw)}`);
    return buildJsonRepairState({
      fromPhase: 'judge',
      raw,
      schema:
        '{"decision":"advance|retry_step|replan|complete|fatal","reason":"string","finalAnswer?":"string","suggestedPlanFix?":"string"}',
      message: `Critic JSON invalid: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}
