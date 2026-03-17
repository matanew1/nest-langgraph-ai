import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '@config/env';
import type { AgentState } from '../state/agent.state';
import { toolRegistry } from '../tools';

/* ------------------------------------------------------------------ */
/*  Template loader                                                     */
/* ------------------------------------------------------------------ */

const TEMPLATES_DIR = join(__dirname, 'templates');

function loadTemplate(name: string): string {
  return readFileSync(join(TEMPLATES_DIR, `${name}.txt`), 'utf-8');
}

// Load once at module initialisation — fast, synchronous, cached in memory
const templates = {
  supervisor: loadTemplate('supervisor'),
  planner: loadTemplate('planner'),
  critic: loadTemplate('critic'),
};

/**
 * Render a template by replacing every {{key}} placeholder with the
 * corresponding value from `vars`. Unknown keys are left as-is.
 */
function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  );
}

/* ------------------------------------------------------------------ */
/*  Shared constants injected into every template                      */
/* ------------------------------------------------------------------ */

const JSON_ONLY =
  'CRITICAL: Your entire response must be a single JSON object. Start with { and end with }. No prose, no markdown, no code fences, no explanation outside the JSON.';

const SELF_REFLECTION =
  'Silently verify before output: (1) starts with {  (2) ends with }  (3) no text outside the JSON  (4) no hallucinated tools.';

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                      */
/* ------------------------------------------------------------------ */

function formatAttempts(state: AgentState): string {
  const all = state.attempts ?? [];
  const recent = all.slice(-env.promptMaxAttempts);
  let displayRecent = recent;
  let trimNote = '';

  // Context trimming utility to prevent prompt bloat during deep recursive iterations
  let totalPreviewChars = 0;
  for (const a of recent) {
    totalPreviewChars +=
      JSON.stringify(a.params).length + Math.min(a.result.preview.length, 200);
  }
  if (totalPreviewChars > env.promptMaxSummaryChars) {
    displayRecent = recent.slice(-3);
    trimNote = `\n[TASK TRIMMED: ${recent.length - 3} earlier attempts to fit context window]`;
  }

  if (displayRecent.length === 0) return '';

  const lines = displayRecent.map(
    (a, i) =>
      `${i + 1}. step=${a.step + 1} tool="${a.tool}" params=${JSON.stringify(a.params)} → ${a.result.ok ? 'OK' : 'ERROR'}: ${a.result.preview.slice(0, 150)}...`,
  );
  return `\nPrevious attempts:${trimNote}\n${lines.join('\n')}`;
}

function getAvailableTools(state: AgentState): string {
  const erroredToolNames = new Set(
    (state.attempts ?? [])
      .slice(-1)
      .filter((a) => !a.result.ok)
      .map((a) => a.tool),
  );
  return toolRegistry
    .getToolsWithParams()
    .split('\n')
    .filter((line) => {
      const name = line.match(/^- (\w+):/)?.[1];
      return !name || !erroredToolNames.has(name);
    })
    .join('\n');
}

/* ------------------------------------------------------------------ */
/*  Public prompt builders                                              */
/* ------------------------------------------------------------------ */

export const buildSupervisorPrompt = (state: AgentState): string =>
  render(templates.supervisor, {
    JSON_ONLY,
    SELF_REFLECTION,
    workingDir: env.agentWorkingDir,
    availableTools: getAvailableTools(state),
    attempts: formatAttempts(state),
    input: state.input,
  });

export const buildPlannerPrompt = (state: AgentState): string =>
  render(templates.planner, {
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

  return render(templates.critic, {
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
