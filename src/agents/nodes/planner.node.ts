import { Logger } from '@nestjs/common';
import { llm } from '@providers/llm.provider';
import type { AgentState } from '@state/agent.state';
import { extractJson } from '@utils/json.util';
import { buildPlannerPrompt } from '../prompts/agent.prompts';

const logger = new Logger('PlannerNode');

interface PlanDecision {
  refinedQuery: string;
  focus: string;
  successCriteria: string;
}

export async function plannerNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  logger.log(
    `Planning execution for tool="${state.selectedTool}", input="${state.toolInput}"`,
  );

  const prompt = buildPlannerPrompt(state);

  const res = await llm.invoke(prompt);
  const raw = res.content as string;

  logger.debug(`Raw LLM response:\n${raw}`);

  try {
    const plan = extractJson<PlanDecision>(raw);

    const planSummary = `Focus: ${plan.focus} | Success: ${plan.successCriteria}`;
    logger.log(`Plan → query="${plan.refinedQuery}", ${planSummary}`);

    return {
      toolInput: plan.refinedQuery,
      executionPlan: planSummary,
    };
  } catch (error) {
    logger.error(`Failed to parse planner response: ${raw}`);
    // Keep original toolInput if planning fails
    return {
      executionPlan: undefined,
    };
  }
}
