import { env } from '@config/env';
import type { AgentState } from '../state/agent.state';
import {
  formatAttempts,
  getAvailableTools,
  JSON_ONLY,
  SELF_REFLECTION,
} from './prompt-context.util';
import {
  getPromptTemplate,
  renderPromptTemplate,
} from './prompt-template.util';

/* ------------------------------------------------------------------ */
/*  Public prompt builders                                              */
/* ------------------------------------------------------------------ */

export const buildSupervisorPrompt = (state: AgentState): string =>
  renderPromptTemplate(getPromptTemplate('supervisor'), {
    JSON_ONLY,
    SELF_REFLECTION,
    workingDir: env.agentWorkingDir,
    availableTools: getAvailableTools(state),
    attempts: formatAttempts(state),
    input: state.input,
  });

export const buildPlannerPrompt = (state: AgentState): string =>
  renderPromptTemplate(getPromptTemplate('planner'), {
    JSON_ONLY,
    SELF_REFLECTION,
    workingDir: env.agentWorkingDir,
    availableTools: getAvailableTools(state),
    attempts: formatAttempts(state),
    objective: state.objective ?? state.input,
    projectContext: state.projectContext ?? '(not available)',
  });

export const buildCriticPrompt = (state: AgentState): string => {
  const plan = state.plan ?? [];
  const currentStep = state.currentStep ?? 0;
  const totalSteps = plan.length;
  const isLastStep = currentStep >= totalSteps - 1;

  const toolResult = state.toolResult;
  const PREVIEW = env.criticResultMaxChars;
  const previewText = toolResult?.preview ?? '(empty)';
  const resultPreview =
    previewText.length > PREVIEW
      ? `${previewText.slice(0, PREVIEW)}\n… [${previewText.length} chars total]`
      : previewText || '(empty)';

  return renderPromptTemplate(getPromptTemplate('critic'), {
    JSON_ONLY,
    SELF_REFLECTION,
    objective: state.objective ?? state.input,
    currentStep: String(currentStep + 1),
    totalSteps: String(totalSteps),
    stepDescription: plan[currentStep]?.description ?? 'N/A',
    selectedTool: state.selectedTool ?? 'unknown',
    successSignal: toolResult?.ok ? 'YES' : 'NO',
    resultPreview,
    stepContext: isLastStep
      ? '*** THIS IS THE LAST STEP ***'
      : `More steps remain after this one (${totalSteps - currentStep - 1} left).`,
  });
};
