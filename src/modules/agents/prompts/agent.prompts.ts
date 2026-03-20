import { env } from '@config/env';
import type { AgentState } from '../state/agent.state';
import { AGENT_CONSTANTS } from '../graph/agent.config';
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
    ? `\n\nConversation history:\n${state.sessionMemory.slice(0, AGENT_CONSTANTS.chatMemoryMaxChars)}`
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

  const criticReason = state.criticDecision?.reason ?? '';

  return [
    `You are a technical assistant synthesizing a final answer for the user.`,
    ``,
    `OBJECTIVE:`,
    state.objective ?? state.input,
    ``,
    `COMPLETED STEPS (tool → output preview):`,
    steps || '(none)',
    ...(criticReason ? [`\nCRITIC ASSESSMENT:\n${criticReason}`] : []),
    ``,
    `INSTRUCTIONS:`,
    `1. Directly answer the objective based on the step outputs above.`,
    `2. If a tool saved content to a file (result contains 'saved to', 'written to', or a file path) — confirm the file path and describe what was saved in one sentence. Do NOT reproduce, embed, or quote the file contents inline.`,
    `3. If the result is informational — summarize clearly in 1-3 short paragraphs or a bullet list.`,
    `4. Include concrete facts, file paths, function names, or values from the tool outputs when they are part of the answer.`,
    `5. Do NOT say "the agent did X" or "step N shows Y" — speak directly to the user as if you did the work yourself.`,
    `6. Do NOT repeat raw tool dumps verbatim; distill to what the user needs to know.`,
    `7. If the task involved creating or editing a file, confirm the file path and what changed.`,
    `8. End with a one-line summary of what was accomplished if the answer is longer than 3 lines.`,
    ``,
    `Answer:`,
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
