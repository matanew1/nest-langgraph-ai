import { Logger } from '@nestjs/common';
import {
  logPhaseStart,
  logPhaseEnd,
  startTimer,
  preview,
} from '@utils/pretty-log.util';
import { buildPlannerPrompt } from '../prompts/agent.prompts';
import { AGENT_PHASES } from '../state/agent-phase';
import {
  failAgentRun,
  transitionToPhase,
} from '../state/agent-transition.util';
import { AgentState, PlanStep } from '../state/agent.state';
import { plannerOutputSchema } from '../state/agent.schemas';
import {
  buildJsonRepairState,
  getStructuredNodeRawResponse,
  parseStructuredNodeOutput,
} from './structured-output.util';

const logger = new Logger('Planner');

export async function plannerNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();
  const objective = state.objective ?? state.input;

  logPhaseStart('PLANNER', `objective="${preview(objective)}"`);

  const raw = await getStructuredNodeRawResponse(state, logger, () =>
    buildPlannerPrompt(state),
  );

  try {
    const plan = parseStructuredNodeOutput(raw, plannerOutputSchema) as {
      objective: string;
      steps: PlanStep[];
      expected_result: string;
    };

    // Validate plan structure
    if (!plan.steps || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      logPhaseEnd('PLANNER', 'FAILED: empty or invalid steps', elapsed());
      return failAgentRun('Failed to create an execution plan.', undefined, {
        jsonRepairResult: undefined,
      });
    }

    const firstStep = plan.steps[0];
    const planSummary = plan.steps
      .map((s) => `  ${s.step_id}. [${s.tool}] ${s.description}`)
      .join('\n');

    logPhaseEnd('PLANNER', `${plan.steps.length}-step plan created`, elapsed());
    logger.log(`Plan:\n${planSummary}`);

    return transitionToPhase(AGENT_PHASES.VALIDATE_PLAN, {
      plan: plan.steps,
      currentStep: 0,
      selectedTool: firstStep.tool,
      toolParams: firstStep.input,
      expectedResult: plan.expected_result,
      objective: plan.objective,
      jsonRepairResult: undefined,
    });
  } catch (e) {
    logPhaseEnd('PLANNER', 'PARSE FAILED → json_repair', elapsed());
    logger.error(`Raw response: ${preview(raw)}`);
    return buildJsonRepairState({
      fromPhase: AGENT_PHASES.PLAN,
      raw,
      schema:
        '{"objective":"string","steps":[{"step_id":1,"description":"string","tool":"tool_name","input":{}}],"expected_result":"string"}',
      message: `Planner JSON invalid: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}
