import { Logger } from '@nestjs/common';
import { invokeLlm } from '@providers/llm.provider';
import type { AgentState } from '@state/agent.state';
import { extractJson } from '@utils/json.util';
import { buildPlannerPrompt } from '../prompts/agent.prompts';

const logger = new Logger('PlannerNode');

interface PlanDecision {
  params: Record<string, unknown>;
  reasoning: string;
}

export async function plannerNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  logger.log(
    `Planning for tool="${state.selectedTool}", current params=${JSON.stringify(state.toolParams)}`,
  );

  const prompt = buildPlannerPrompt(state);
  const raw = await invokeLlm(prompt);

  logger.debug(`Raw LLM response:\n${raw}`);

  try {
    const plan = extractJson<PlanDecision>(raw);

    logger.log(
      `Plan refined → params=${JSON.stringify(plan.params)}, reasoning="${plan.reasoning}"`,
    );

    return {
      toolParams: plan.params,
      toolInput: JSON.stringify(plan.params),
      executionPlan: plan.reasoning,
    };
  } catch {
    // Planning failed — keep the params set by the supervisor and continue
    logger.error(
      `Failed to parse planner response, keeping supervisor params: ${raw}`,
    );
    return {};
  }
}
