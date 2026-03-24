import { Logger } from '@nestjs/common';
import { buildCriticPrompt } from '../prompts/agent.prompts';
import { logPhaseStart, logPhaseEnd, startTimer } from '@utils/pretty-log.util';
import { AGENT_PHASES } from '../state/agent-phase';
import { transitionToPhase } from '../state/agent-transition.util';
import { AgentState } from '../state/agent.state';
import { criticDecisionSchema } from '../state/agent.schemas';
import { getStructuredNodeRawResponse } from './structured-output.util';
import { parseWithRepair } from './parse-with-repair.util';

const logger = new Logger('Critic');

/**
 * Synthesize a finalAnswer from whatever the agent has produced so far.
 * Used as a fallback when the LLM omits finalAnswer on a complete/fatal decision.
 */
function synthesizeFinalAnswer(state: AgentState): string {
  return (
    state.toolResult?.preview ??
    state.toolResultRaw ??
    state.attempts?.at(-1)?.result?.preview ??
    'Task completed successfully.'
  );
}

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

  // Try lenient parse first: extract decision/reason even if finalAnswer is missing,
  // then synthesize finalAnswer to avoid the infinite json_repair loop.
  let parsed: ReturnType<typeof JSON.parse> | null = null;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    parsed = null;
  }

  if (
    parsed &&
    (parsed.decision === 'complete' || parsed.decision === 'fatal') &&
    !parsed.finalAnswer
  ) {
    const synthesized = synthesizeFinalAnswer(state);
    logger.warn(
      `Critic returned "${parsed.decision}" without finalAnswer — synthesizing from state`,
    );
    const decision = {
      decision: parsed.decision as 'complete' | 'fatal',
      reason: parsed.reason ?? 'Task completed.',
      finalAnswer: synthesized,
    };
    logPhaseEnd(
      'CRITIC',
      `DECISION: ${decision.decision} (synthesized answer)`,
      elapsed(),
    );
    return transitionToPhase(AGENT_PHASES.ROUTE, {
      criticDecision: decision,
    });
  }

  const decision = await parseWithRepair(
    raw,
    criticDecisionSchema,
    '{"decision":"advance|retry_step|replan|complete|fatal","reason":"string","finalAnswer?":"string"}',
  );

  logPhaseEnd('CRITIC', `DECISION: ${decision.decision}`, elapsed());
  return transitionToPhase(AGENT_PHASES.ROUTE, {
    criticDecision: decision,
  });
}
