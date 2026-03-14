import { Logger } from '@nestjs/common';
import { invokeLlm } from '@llm/llm.provider';
import { prettyJson, logPhaseStart, logPhaseEnd, startTimer, preview } from '@utils/pretty-log.util';
import { extractJson } from '@utils/json.util';
import { buildPlannerPrompt } from '../prompts/agent.prompts';
import { AgentState, PlanStep } from '../state/agent.state';
import { toolRegistry } from '../tools';

const logger = new Logger('Planner');

interface PlanDecision {
  objective: string;
  steps: PlanStep[];
  expected_result: string;
}

export async function plannerNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();
  const objective = state.executionPlan ?? state.input;

  logPhaseStart('PLANNER', `objective="${preview(objective, 80)}"`);

  const prompt = buildPlannerPrompt(state);
  const raw = await invokeLlm(prompt);

  logger.debug(`LLM response:\n${preview(raw, 300)}`);

  try {
    const plan = extractJson<PlanDecision>(raw);

    // Validate plan structure
    if (!plan.steps || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      logPhaseEnd('PLANNER', 'FAILED: empty or invalid steps', elapsed());
      return {
        status: 'error',
        done: true,
        finalAnswer: 'Failed to create an execution plan.',
      };
    }

    // Validate all referenced tools exist
    for (const step of plan.steps) {
      if (!toolRegistry.has(step.tool)) {
        logPhaseEnd('PLANNER', `FAILED: unknown tool "${step.tool}"`, elapsed());
        return {
          status: 'error',
          done: true,
          finalAnswer: `Planning failed: unknown tool "${step.tool}".`,
        };
      }
    }

    const firstStep = plan.steps[0];
    const planSummary = plan.steps
      .map((s) => `  ${s.step_id}. [${s.tool}] ${s.description}`)
      .join('\n');

    logPhaseEnd('PLANNER', `${plan.steps.length}-step plan created`, elapsed());
    logger.log(`Plan:\n${planSummary}`);

    return {
      plan: plan.steps,
      currentStep: 0,
      status: 'running',
      selectedTool: firstStep.tool,
      toolParams: firstStep.input,
      toolInput: prettyJson(firstStep.input),
      executionPlan: plan.objective,
      expectedResult: plan.expected_result,
    };
  } catch {
    logPhaseEnd('PLANNER', 'PARSE FAILED', elapsed());
    logger.error(`Raw response: ${preview(raw, 500)}`);
    return {
      status: 'error',
      done: true,
      finalAnswer: 'Failed to parse the execution plan. Please try again.',
    };
  }
}
