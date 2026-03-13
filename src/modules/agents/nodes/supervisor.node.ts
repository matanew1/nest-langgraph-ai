import { Logger } from '@nestjs/common';
import { invokeLlm } from '@llm/llm.provider';
import { extractJson } from '@utils/json.util';
import { buildSupervisorPrompt } from '../prompts/agent.prompts';
import { AgentState } from '../state/agent.state';

const logger = new Logger('SupervisorNode');

interface SupervisorDecision {
  status: string;
  task?: string;
  message?: string;
  suggestion?: string;
}

export async function supervisorNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  logger.log(`Received input: "${state.input}"`);

  const prompt = buildSupervisorPrompt(state);
  const raw = await invokeLlm(prompt);

  logger.debug(`Raw LLM response:\n${raw}`);

  const iteration = (state.iteration ?? 0) + 1;

  try {
    const decision = extractJson<SupervisorDecision>(raw);

    if (decision.status === 'error') {
      logger.warn(`Task unsupported — ${decision.message}`);
      return {
        status: 'error',
        done: true,
        finalAnswer:
          decision.message ??
          'Task cannot be completed with available tools.',
        iteration,
      };
    }

    logger.log(
      `Decision → status="${decision.status}", task="${decision.task}"`,
    );

    return {
      status: 'plan_required',
      executionPlan: decision.task ?? state.input,
      iteration,
    };
  } catch {
    // Parse failed — assume solvable and pass the raw input through
    logger.error(
      `Failed to parse supervisor response, proceeding with raw input`,
    );
    return {
      status: 'plan_required',
      executionPlan: state.input,
      iteration,
    };
  }
}
