import { Logger } from '@nestjs/common';
import { toolRegistry } from '../tools/index';
import { logPhaseStart, logPhaseEnd, startTimer } from '@utils/pretty-log.util';
import { AGENT_PHASES } from '../state/agent-phase';
import { AGENT_CONSTANTS } from '../graph/agent.config';
import { transitionToPhase } from '../state/agent-transition.util';
import type { AgentState } from '../state/agent.state';
import { buildVectorResearchContext } from '@vector-db/vector-memory.util';
import { invokeLlm } from '@llm/llm.provider';

const logger = new Logger('Researcher');

/**
 * Summarize a large context block using the LLM when it exceeds the threshold.
 * Returns the original text if it is within the threshold or summarization fails.
 */
const SUMMARIZE_THRESHOLD = 4000;

async function maybeSummarize(
  label: string,
  text: string,
  objective: string,
): Promise<string> {
  if (text.length <= SUMMARIZE_THRESHOLD) return text;

  logger.log(
    `Researcher: context "${label}" is ${text.length} chars — summarizing for objective`,
  );

  const prompt = [
    `You are summarizing project context to help an AI agent plan its next actions.`,
    `The agent's current objective is: ${objective}`,
    ``,
    `Summarize the following ${label} concisely. Keep all details that are relevant to the objective.`,
    `Omit details that are clearly irrelevant. Preserve file paths, function names, and exact identifiers.`,
    `Output plain text only — no JSON, no markdown headers.`,
    ``,
    `${label}:`,
    text,
    ``,
    `Summary:`,
  ].join('\n');

  try {
    const summary = await invokeLlm(prompt);
    logger.log(
      `Researcher: summarized "${label}" from ${text.length} → ${summary.length} chars`,
    );
    return summary.trim();
  } catch (e) {
    logger.warn(
      `Researcher: LLM summarization failed for "${label}", using original`,
    );
    return text;
  }
}

/**
 * RESEARCHER node — gathers project context and memory for the planner.
 *
 * Runs between SUPERVISOR and PLANNER to give the planner real
 * knowledge about the project structure and state.
 *
 * Collects:
 *  1. File tree (tree_dir on ".")
 *  2. Git status (git_info status)
 *  3. LLM-summarized context (if raw context > 2000 chars) — reduces token noise
 *  4. Vector search for relevant past attempts matching the current objective
 *
 * The combined workspace context is stored in state.projectContext.
 * Session/vector memory is refreshed every run and stored in state.memoryContext.
 */
export async function researcherNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();

  logPhaseStart('RESEARCHER', 'gathering project context');

  const objective = state.objective ?? state.input;
  const workspaceSections: string[] = [];
  const memorySections: string[] = [];

  if (state.projectContext) {
    // Re-use already gathered context but still summarize if oversized
    const summarized = await maybeSummarize(
      'project context (cached)',
      state.projectContext,
      objective,
    );
    workspaceSections.push(summarized);
  } else {
    // 1. File tree
    const treeTool = toolRegistry.get('tree_dir');
    if (treeTool) {
      try {
        const tree = (await treeTool.invoke({ path: '.' })) as string;
        const maxLines = AGENT_CONSTANTS.researcherTreeMaxLines;
        const lines = tree.split('\n');
        const truncated =
          lines.length > maxLines
            ? lines.slice(0, maxLines).join('\n') +
              `\n… (${lines.length - maxLines} more entries)`
            : tree;
        const section = `## Project file tree\n${truncated}`;
        const summarized = await maybeSummarize(
          'project file tree',
          section,
          objective,
        );
        workspaceSections.push(summarized);
      } catch (e) {
        logger.error('Failed to fetch file tree', e);
        workspaceSections.push('## Project file tree\n(unavailable)');
      }
    }

    // 2. Git status
    const gitTool = toolRegistry.get('git_info');
    if (gitTool) {
      try {
        const status = (await gitTool.invoke({ action: 'status' })) as string;
        workspaceSections.push(
          `## Git status\n${status || '(clean working tree)'}`,
        );
      } catch (e) {
        logger.error('Failed to fetch git status', e);
        workspaceSections.push('## Git status\n(unavailable)');
      }
    }
  }

  if (state.sessionMemory) {
    memorySections.push(`## Session memory\n${state.sessionMemory}`);
  }

  // 3. Vector search: retrieve past attempts that semantically match the current objective.
  // This gives the planner awareness of what has been tried before, avoiding redundant plans.
  const { text: vectorContext, ids: vectorIds } =
    await buildVectorResearchContext(objective);
  memorySections.push(vectorContext);

  // Track vector search failures as non-fatal warnings in state errors.
  const vectorWarnings: import('../state/agent.state').AgentError[] = [];
  if (vectorContext.includes('(unavailable:')) {
    vectorWarnings.push({
      code: 'tool_error',
      message: 'Vector memory search was unavailable during research',
      atPhase: AGENT_PHASES.RESEARCH,
    });
  }

  const projectContext = workspaceSections.join('\n\n');
  const memoryContext = memorySections.join('\n\n');

  logPhaseEnd(
    'RESEARCHER',
    `workspace=${workspaceSections.length} sections, memory=${memorySections.length} sections`,
    elapsed(),
  );

  return transitionToPhase(AGENT_PHASES.PLAN, {
    projectContext,
    memoryContext,
    vectorMemoryIds: vectorIds,
    ...(vectorWarnings.length > 0 ? { errors: vectorWarnings } : {}),
  });
}
