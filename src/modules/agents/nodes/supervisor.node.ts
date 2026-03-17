import { Logger } from '@nestjs/common';
import { invokeLlm } from '@llm/llm.provider';
import { extractJson } from '@utils/json.util';
import {
  logPhaseStart,
  logPhaseEnd,
  startTimer,
  preview,
} from '@utils/pretty-log.util';
import { buildSupervisorPrompt } from '../prompts/agent.prompts';
import { AgentState } from '../state/agent.state';
import { supervisorOutputSchema } from '../state/agent.schemas';

const logger = new Logger('Supervisor');

export async function supervisorNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();

  logPhaseStart(
    'SUPERVISOR',
    `input="${preview(state.input)}"`,
  );

  const prompt = buildSupervisorPrompt(state);
  const raw = await invokeLlm(prompt);

  logger.debug(`LLM response:\n${preview(raw)}`);

  try {
    const parsed = extractJson<unknown>(raw);
    const decision = supervisorOutputSchema.parse(parsed);

    if (decision.status === 'reject') {
      logPhaseEnd('SUPERVISOR', `REJECTED: ${decision.message}`, elapsed());
      return {
        phase: 'fatal',
        finalAnswer: decision.message ?? 'Task cannot be completed.',
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
    };
  } catch (e) {
    logPhaseEnd('SUPERVISOR', 'PARSE FAILED → json_repair', elapsed());
    const msg = e instanceof Error ? e.message : String(e);
    return {
      phase: 'route',
      jsonRepair: {
        fromPhase: 'supervisor',
        raw,
        schema:
          '{"status":"ok|reject","objective?":"string","message?":"string","missing_capabilities?":["string"]}',
      },
      errors: [
        {
          code: 'json_invalid',
          message: `Supervisor JSON invalid: ${msg}`,
          atPhase: 'supervisor',
        },
      ],
    };
  }
}
