import { Logger } from '@nestjs/common';
import type { AgentState } from '../state/agent.state';
import { toolRegistry } from '../tools/index';

const logger = new Logger('ExecutionNode');

export async function executionNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const toolName = state.selectedTool ?? '';
  const toolInput = state.toolInput ?? '';

  logger.log(`Executing tool: ${toolName} with input: ${toolInput}`);

  const tool = toolRegistry.get(toolName);

  if (!tool) {
    const errorMsg = `Unknown tool "${toolName}". Available: ${toolRegistry.getNames().join(', ')}`;
    logger.warn(errorMsg);
    return {
      toolResult: errorMsg,
      lastToolErrored: true,
      attempts: [
        { tool: toolName, input: toolInput, result: errorMsg, error: true },
      ],
    };
  }

  try {
    const result = (await tool.invoke({ query: toolInput })) as string;
    logger.debug(`Tool result: ${result}`);
    return {
      toolResult: result,
      lastToolErrored: false,
      attempts: [
        {
          tool: toolName,
          input: toolInput,
          result: result.length > 300 ? result.slice(0, 300) + '…' : result,
          error: false,
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Tool "${toolName}" failed: ${message}`);
    const errorResult = `Tool "${toolName}" failed: ${message}`;
    return {
      toolResult: errorResult,
      lastToolErrored: true,
      attempts: [
        { tool: toolName, input: toolInput, result: errorResult, error: true },
      ],
    };
  }
}
