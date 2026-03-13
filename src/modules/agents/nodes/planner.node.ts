import { Logger } from '@nestjs/common';
import { invokeLlm } from '@llm/llm.provider';
import { extractJson } from '@utils/json.util';
import { buildPlannerPrompt } from '../prompts/agent.prompts';
import { AgentState, PlanStep } from '../state/agent.state';
import { toolRegistry } from '../tools';

const logger = new Logger('PlannerNode');

interface PlanDecision {
  objective: string;
  steps: PlanStep[];
  expected_result: string;
}

export async function plannerNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  logger.log(`Planning for: "${state.executionPlan ?? state.input}"`);

  const prompt = buildPlannerPrompt(state);
  const raw = await invokeLlm(prompt);

  logger.debug(`Raw LLM response:\n${raw}`);

  try {
    const plan = extractJson<PlanDecision>(raw);

    // Validate plan structure
    if (!plan.steps || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      logger.error('Planner returned empty or invalid steps');
      return {
        status: 'error',
        done: true,
        finalAnswer: 'Failed to create an execution plan.',
      };
    }

    // Validate all referenced tools exist
    for (const step of plan.steps) {
      if (!toolRegistry.has(step.tool)) {
        logger.error(`Planner referenced unknown tool: "${step.tool}"`);
        return {
          status: 'error',
          done: true,
          finalAnswer: `Planning failed: unknown tool "${step.tool}".`,
        };
      }
    }

    const firstStep = plan.steps[0];

    logger.log(
      `Plan created → ${plan.steps.length} steps: ${plan.steps.map((s) => `${s.step_id}:${s.tool}`).join(' → ')}`,
    );

    return {
      plan: plan.steps,
      currentStep: 0,
      status: 'running',
      selectedTool: firstStep.tool,
      toolParams: firstStep.input,
      toolInput: JSON.stringify(firstStep.input),
      executionPlan: plan.objective,
      expectedResult: plan.expected_result,
    };
  } catch {
    logger.error(`Failed to parse planner response: ${raw}`);
    return {
      status: 'error',
      done: true,
      finalAnswer: 'Failed to parse the execution plan. Please try again.',
    };
  }
}
