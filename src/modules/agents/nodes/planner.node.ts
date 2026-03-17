import { Logger } from '@nestjs/common';
import { invokeLlm } from '@llm/llm.provider';
import {
  logPhaseStart,
  logPhaseEnd,
  startTimer,
  preview,
} from '@utils/pretty-log.util';
import { extractJson } from '@utils/json.util';
import { buildPlannerPrompt } from '../prompts/agent.prompts';
import { AgentState, PlanStep } from '../state/agent.state';
import { plannerOutputSchema } from '../state/agent.schemas';

const logger = new Logger('Planner');

export async function plannerNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();
  const objective = state.objective ?? state.input;

  logPhaseStart('PLANNER', `objective="${preview(objective)}"`);

  let raw: string;
  if (state.jsonRepairResult !== undefined) {
    raw = state.jsonRepairResult;
    logger.debug(`Using repaired JSON:\n${preview(raw)}`);
  } else {
    const prompt = buildPlannerPrompt(state);
    raw = await invokeLlm(prompt);
    logger.debug(`LLM response:\n${preview(raw)}`);
  }

  try {
    const parsed = extractJson<unknown>(raw);
    const plan = plannerOutputSchema.parse(parsed) as {
      objective: string;
      steps: PlanStep[];
      expected_result: string;
    };

    // Validate plan structure
    if (!plan.steps || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      logPhaseEnd('PLANNER', 'FAILED: empty or invalid steps', elapsed());
      return {
        phase: 'fatal',
        finalAnswer: 'Failed to create an execution plan.',
        jsonRepairResult: undefined,
      };
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
      selectedTool: firstStep.tool,
      toolParams: firstStep.input,
      expectedResult: plan.expected_result,
      objective: plan.objective,
      phase: 'validate_plan',
      jsonRepairResult: undefined,
    };
  } catch (e) {
    logPhaseEnd('PLANNER', 'PARSE FAILED → json_repair', elapsed());
    logger.error(`Raw response: ${preview(raw)}`);
    return {
      phase: 'route',
      jsonRepair: {
        fromPhase: 'plan',
        raw,
        schema:
          '{"objective":"string","steps":[{"step_id":1,"description":"string","tool":"tool_name","input":{}}],"expected_result":"string"}',
      },
      errors: [
        {
          code: 'json_invalid',
          message: `Planner JSON invalid: ${e instanceof Error ? e.message : String(e)}`,
          atPhase: 'plan',
        },
      ],
    };
  }
}