import { Logger } from '@nestjs/common';
import { toolRegistry } from '../tools/index';
import { logPhaseStart, logPhaseEnd, startTimer } from '@utils/pretty-log.util';
import { AGENT_PHASES } from '../state/agent-phase';
import { transitionToPhase } from '../state/agent-transition.util';
import type { AgentState } from '../state/agent.state';
import { buildVectorResearchContext } from '@vector-db/vector-memory.util';

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
    workspaceSections.push(state.projectContext);
  } else {
    // 1. File tree
    const treeTool = toolRegistry.get('tree_dir');
    if (treeTool) {
      try {
        const tree = (await treeTool.invoke({ path: '.' })) as string;
        const maxLines = 80;
        const lines = tree.split('\n');
        const truncated =
          lines.length > maxLines
            ? lines.slice(0, maxLines).join('\n') +
              `\n… (${lines.length - maxLines} more entries)`
            : tree;
        workspaceSections.push(`## Project file tree\n${truncated}`);
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

  memorySections.push(await buildVectorResearchContext(objective));

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
  });
}
