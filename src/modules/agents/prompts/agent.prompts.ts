import { env } from '@config/env';
import type { AgentState } from '../state/agent.state';
import {
  formatAttempts,
  formatPromptSection,
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
    sessionMemory: formatPromptSection(
      state.sessionMemory,
      '(none available)',
      env.promptMaxSummaryChars,
    ),
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
    projectContext: formatPromptSection(
      state.projectContext,
      '(not available)',
      env.promptMaxSummaryChars * 2,
    ),
    memoryContext: formatPromptSection(
      state.memoryContext ?? state.sessionMemory,
      '(none available)',
      env.promptMaxSummaryChars,
    ),
  });

export const buildChatPrompt = (state: AgentState): string => {
  const memory = state.sessionMemory
    ? `\n\nConversation history:\n${state.sessionMemory.slice(0, 800)}`
    : '';

  return [
    `You are a friendly, helpful AI assistant. Be warm, natural, and conversational.`,
    `- For greetings, respond warmly and offer to help.`,
    `- For follow-up questions, use the conversation history to give context-aware answers.`,
    `- Keep answers concise but complete. Use markdown for structure when helpful.`,
    `- Never say you "cannot" answer something that is a simple conversational or general knowledge question.`,
    memory,
    `\nUser: ${state.input}`,
    `\nAssistant:`,
  ].join('\n');
};

export const buildGeneratorPrompt = (state: AgentState): string => {
  const steps = (state.attempts ?? [])
    .map(
      (a, i) =>
        `Step ${i + 1} [${a.tool}]: ${a.result?.preview ?? JSON.stringify(a.result)}`,
    )
    .join('\n');
  return [
    `You are a technical assistant. The user's objective was:`,
    state.objective ?? state.input,
    `\nThe agent completed the following steps:\n${steps || '(none)'}`,
    `\nSynthesize a clear, complete, user-facing answer. Be concise. Do not include raw tool output unless it is the answer itself.`,
    `\nAnswer:`,
  ].join('\n');
};

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
    expectedResult: state.expectedResult ?? '(not specified)',
    currentStep: String(currentStep + 1),
    totalSteps: String(totalSteps),
    stepDescription: plan[currentStep]?.description ?? 'N/A',
    selectedTool: state.selectedTool ?? 'unknown',
    successSignal: toolResult?.ok ? 'YES' : 'NO',
    resultPreview,
    attempts: formatAttempts(state) || '\nPrevious attempts:\n(none)',
    stepContext: isLastStep
      ? '*** THIS IS THE LAST STEP ***'
      : `More steps remain after this one (${totalSteps - currentStep - 1} left).`,
  });
};
