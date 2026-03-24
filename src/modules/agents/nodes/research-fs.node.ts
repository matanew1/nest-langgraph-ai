import { Logger } from '@nestjs/common';
import { toolRegistry } from '../tools/index';
import { logPhaseStart, logPhaseEnd, startTimer } from '@utils/pretty-log.util';
import { AGENT_CONSTANTS } from '../graph/agent.config';
import { invokeLlm } from '@llm/llm.provider';
import type { AgentState } from '@state/agent.state';

const logger = new Logger('ResearchFs');

const SUMMARIZE_THRESHOLD = 4000;

async function maybeSummarize(
  label: string,
  text: string,
  objective: string,
): Promise<string> {
  if (text.length <= SUMMARIZE_THRESHOLD) return text;

  logger.log(
    `ResearchFs: context "${label}" is ${text.length} chars — summarizing for objective`,
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
      `ResearchFs: summarized "${label}" from ${text.length} → ${summary.length} chars`,
    );
    return summary.trim();
  } catch {
    logger.warn(
      `ResearchFs: LLM summarization failed for "${label}", using original`,
    );
    return text;
  }
}

/**
 * RESEARCH_FS node — gathers filesystem context for the planner.
 *
 * Collects:
 *  1. File tree (tree_dir on ".")
 *  2. Git status (git_info status)
 *  3. LLM-summarized context (if raw context > SUMMARIZE_THRESHOLD chars)
 *
 * Writes only `projectContext` — does NOT set phase or write memoryContext.
 */
export async function researchFsNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const elapsed = startTimer();

  logPhaseStart('RESEARCH_FS', 'gathering filesystem context');

  const objective = state.objective ?? state.input;
  const workspaceSections: string[] = [];

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

  const projectContext = workspaceSections.join('\n\n');

  logPhaseEnd(
    'RESEARCH_FS',
    `workspace=${workspaceSections.length} sections`,
    elapsed(),
  );

  return { projectContext };
}
