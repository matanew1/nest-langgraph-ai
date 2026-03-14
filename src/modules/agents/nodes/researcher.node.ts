import { Logger } from '@nestjs/common';
import { toolRegistry } from '../tools/index';
import {
  logPhaseStart,
  logPhaseEnd,
  startTimer,
  preview,
} from '@utils/pretty-log.util';
import type { AgentState } from '../state/agent.state';

const logger = new Logger('Researcher');

/**
 * RESEARCHER node — gathers project context automatically (no LLM call).
 *
 * Runs between SUPERVISOR and PLANNER to give the planner real
 * knowledge about the project structure and state.
 *
 * Collects:
 *  1. File tree (tree_dir on ".")
 *  2. Git status (git_info status)
 *
 * The combined context is stored in state.projectContext and
 * injected into the planner prompt.
 */
export async function researcherNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  // Skip on retry cycles — project context hasn't changed
  if (state.projectContext) {
    logPhaseStart('RESEARCHER', 'skipping — context already gathered');
    logPhaseEnd('RESEARCHER', 'skipped (cached)', 0);
    return {};
  }

  const elapsed = startTimer();

  logPhaseStart('RESEARCHER', 'gathering project context');

  const sections: string[] = [];

  // 1. File tree
  const treeTool = toolRegistry.get('tree_dir');
  if (treeTool) {
    try {
      const tree = (await treeTool.invoke({ path: '.' })) as string;
      // Truncate to keep prompt size reasonable
      const maxLines = 80;
      const lines = tree.split('\n');
      const truncated =
        lines.length > maxLines
          ? lines.slice(0, maxLines).join('\n') +
            `\n… (${lines.length - maxLines} more entries)`
          : tree;
      sections.push(`## Project file tree\n${truncated}`);
    } catch (e) {
      logger.error('Failed to fetch file tree', e);
      sections.push('## Project file tree\n(unavailable)');
    }
  }

  // 2. Git status
  const gitTool = toolRegistry.get('git_info');
  if (gitTool) {
    try {
      const status = (await gitTool.invoke({ action: 'status' })) as string;
      sections.push(`## Git status\n${status || '(clean working tree)'}`);
    } catch (e) {
      logger.error('Failed to fetch git status', e);
      sections.push('## Git status\n(unavailable)');
    }
  }

  const projectContext = sections.join('\n\n');

  logPhaseEnd(
    'RESEARCHER',
    `gathered ${sections.length} sections (${projectContext.length} chars)`,
    elapsed(),
  );

  return { projectContext };
}
