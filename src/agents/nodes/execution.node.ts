import { Logger } from '@nestjs/common';
import type { AgentState } from '../state/agent.state';
import { toolRegistry } from '../tools/index';
import { env } from '../../config/env';

const logger = new Logger('ExecutionNode');

const ATTEMPT_PREVIEW_LENGTH = 300;

export async function executionNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const toolName = state.selectedTool ?? '';
  // Use structured params set by supervisor/planner; fall back to a plain
  // {query} object so the search tool still works when params are missing.
  const toolParams: Record<string, unknown> =
    state.toolParams ?? { query: state.toolInput ?? '' };

  logger.log(
    `Executing tool="${toolName}" with params=${JSON.stringify(toolParams)}`,
  );

  const tool = toolRegistry.get(toolName);

  if (!tool) {
    const errorMsg = `Unknown tool "${toolName}". Available: ${toolRegistry.getNames().join(', ')}`;
    logger.warn(errorMsg);
    return {
      toolResult: errorMsg,
      lastToolErrored: true,
      attempts: [{
        tool: toolName,
        input: JSON.stringify(toolParams),
        params: toolParams,
        result: errorMsg,
        error: true,
      }],
    };
  }

  try {
    // Pass the full structured params object — each tool validates its own
    // schema via Zod, so write_file gets {path, content}, read_file gets {path}, etc.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.toolTimeoutMs);
    let result: string;
    try {
      result = (await tool.invoke(toolParams, { signal: controller.signal })) as string;
    } finally {
      clearTimeout(timer);
    }
    if (controller.signal.aborted) {
      throw new Error(`Tool "${toolName}" timed out after ${env.toolTimeoutMs}ms`);
    }
    const preview =
      result.length > ATTEMPT_PREVIEW_LENGTH
        ? result.slice(0, ATTEMPT_PREVIEW_LENGTH) + '…'
        : result;

    logger.debug(`Tool result preview: ${preview}`);
    return {
      toolResult: result,
      lastToolErrored: false,
      attempts: [{
        tool: toolName,
        input: JSON.stringify(toolParams),
        params: toolParams,
        result: preview,
        error: false,
      }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Tool "${toolName}" failed: ${message}`);
    const errorResult = `Tool "${toolName}" failed: ${message}`;
    return {
      toolResult: errorResult,
      lastToolErrored: true,
      attempts: [{
        tool: toolName,
        input: JSON.stringify(toolParams),
        params: toolParams,
        result: errorResult,
        error: true,
      }],
    };
  }
}
