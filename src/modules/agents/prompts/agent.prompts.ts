import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '@config/env';
import type { AgentState } from '../state/agent.state';
import { toolRegistry } from '../tools/tool.registry';

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
  if (recent.length === 0) return '';
  const lines = recent.map(
    (a, i) =>
      `${i + 1}. tool="${a.tool}", input=${a.input} → ${a.error ? 'ERROR: ' : ''}${a.result.slice(0, 200)}`,
  );
  return `\nPrevious attempts:\n${lines.join('\n')}`;
}

function getAvailableTools(state: AgentState): string {
  const erroredToolNames = new Set(
    (state.attempts ?? []).filter((a) => a.error).map((a) => a.tool),
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
    objective: state.executionPlan ?? state.input,
    projectContext: state.projectContext ?? '(not available)',
  });

export const buildCriticPrompt = (state: AgentState): string => {
  const plan = state.plan ?? [];
  const currentStep = state.currentStep ?? 0;
  const totalSteps = plan.length;
  const isLastStep = currentStep >= totalSteps - 1;

  const rawResult = state.toolResult ?? '';
  const PREVIEW = env.criticResultMaxChars;
  const resultPreview =
    rawResult.length > PREVIEW
      ? `${rawResult.slice(0, PREVIEW)}\n… [${rawResult.length} chars total]`
      : rawResult || '(empty)';

  const looksSuccessful =
    !rawResult.startsWith('ERROR') &&
    !rawResult.startsWith('Tool "') &&
    !rawResult.startsWith('error:') &&
    rawResult.length > 0;

  return render(templates.critic, {
    JSON_ONLY,
    SELF_REFLECTION,
    objective: state.executionPlan ?? state.input,
    currentStep: String(currentStep + 1),
    totalSteps: String(totalSteps),
    stepDescription: plan[currentStep]?.description ?? 'N/A',
    selectedTool: state.selectedTool ?? 'unknown',
    successSignal: looksSuccessful
      ? 'YES (no error prefix)'
      : 'NO (error prefix detected)',
    resultPreview,
    stepContext: isLastStep
      ? '*** THIS IS THE LAST STEP ***'
      : `More steps remain after this one (${totalSteps - currentStep - 1} left).`,
  });
};
