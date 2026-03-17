import { Logger } from '@nestjs/common';
import {
  logPhaseStart,
  logPhaseEnd,
  startTimer,
  preview,
} from '@utils/pretty-log.util';
import { buildSupervisorPrompt } from '../prompts/agent.prompts';
import { AGENT_PHASES } from '../state/agent-phase';
import {
  requestClarification,
  transitionToPhase,
} from '../state/agent-transition.util';
import { AgentState } from '../state/agent.state';
import { supervisorOutputSchema } from '../state/agent.schemas';
import {
  buildJsonRepairState,
  getStructuredNodeRawResponse,
  parseStructuredNodeOutput,
} from './structured-output.util';

const logger = new Logger('Supervisor');

export async function supervisorNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();

  logPhaseStart('SUPERVISOR', `input="${preview(state.input)}"`);

  const raw = await getStructuredNodeRawResponse(state, logger, () =>
    buildSupervisorPrompt(state),
  );

  try {
    const decision = parseStructuredNodeOutput(raw, supervisorOutputSchema);

    if (decision.status === 'reject') {
      logPhaseEnd('SUPERVISOR', `REJECTED: ${decision.message}`, elapsed());
      return requestClarification(
        {
          code: 'unknown',
          message: decision.message ?? 'Supervisor rejected the task.',
          atPhase: AGENT_PHASES.SUPERVISOR,
          details: {
            missing_capabilities: decision.missing_capabilities ?? [],
          },
        },
        { jsonRepairResult: undefined },
      );
    }

    const objective = decision.objective ?? state.input;
    logPhaseEnd('SUPERVISOR', `APPROVED → "${preview(objective)}"`, elapsed());

    return transitionToPhase(AGENT_PHASES.RESEARCH, {
      objective,
      jsonRepairResult: undefined,
    });
  } catch (e) {
    logPhaseEnd('SUPERVISOR', 'PARSE FAILED → json_repair', elapsed());
    return buildJsonRepairState({
      fromPhase: AGENT_PHASES.SUPERVISOR,
      raw,
      schema:
        '{"status":"ok|reject","objective?":"string","message?":"string","missing_capabilities?":["string"]}',
      message: `Supervisor JSON invalid: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}
