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

const logger = new Logger('Supervisor');

interface SupervisorDecision {
  status: string;
  task?: string;
  message?: string;
}

export async function supervisorNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();
  const iteration = (state.iteration ?? 0) + 1;

  logPhaseStart(
    'SUPERVISOR',
    `iteration=${iteration} | input="${preview(state.input, 80)}"`,
  );

  const prompt = buildSupervisorPrompt(state);
  const raw = await invokeLlm(prompt);

  logger.debug(`LLM response:\n${preview(raw, 300)}`);

  try {
    const decision = extractJson<SupervisorDecision>(raw);

    if (decision.status === 'error') {
      logPhaseEnd('SUPERVISOR', `REJECTED: ${decision.message}`, elapsed());
      return {
        status: 'error',
        done: true,
        finalAnswer:
          decision.message ?? 'Task cannot be completed with available tools.',
        iteration,
      };
    }

    const task = decision.task ?? state.input;
    logPhaseEnd('SUPERVISOR', `APPROVED → "${preview(task, 80)}"`, elapsed());

    return {
      status: 'plan_required',
      executionPlan: task,
      iteration,
    };
  } catch {
    logPhaseEnd('SUPERVISOR', 'PARSE FAILED → forwarding raw input', elapsed());
    return {
      status: 'plan_required',
      executionPlan: state.input,
      iteration,
    };
  }
}
