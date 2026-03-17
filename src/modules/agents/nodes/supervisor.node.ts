import { Logger } from '@nestjs/common';
import {
  logPhaseStart,
  logPhaseEnd,
  startTimer,
  preview,
} from '@utils/pretty-log.util';
import { buildSupervisorPrompt } from '../prompts/agent.prompts';
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
      return {
        phase: 'clarification',
        jsonRepairResult: undefined,
        errors: [
          {
            code: 'unknown',
            message: decision.message ?? 'Supervisor rejected the task.',
            atPhase: 'supervisor',
            details: {
              missing_capabilities: decision.missing_capabilities ?? [],
            },
          },
        ],
      };
    }

    const objective = decision.objective ?? state.input;
    logPhaseEnd('SUPERVISOR', `APPROVED → "${preview(objective)}"`, elapsed());

    return {
      phase: 'research',
      objective,
      jsonRepairResult: undefined,
    };
  } catch (e) {
    logPhaseEnd('SUPERVISOR', 'PARSE FAILED → json_repair', elapsed());
    return buildJsonRepairState({
      fromPhase: 'supervisor',
      raw,
      schema:
        '{"status":"ok|reject","objective?":"string","message?":"string","missing_capabilities?":["string"]}',
      message: `Supervisor JSON invalid: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}
