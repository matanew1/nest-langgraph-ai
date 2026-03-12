import { Logger } from '@nestjs/common';
import { invokeLlm } from '@providers/llm.provider';
import type { AgentState } from '@state/agent.state';
import { extractJson } from '@utils/json.util';
import { buildSupervisorPrompt } from '../prompts/agent.prompts';
import { toolRegistry } from '../tools/index';

const logger = new Logger('SupervisorNode');

function pickFallbackTool(state: AgentState): string {
  const erroredTools = new Set(
    (state.attempts ?? []).filter((a) => a.error).map((a) => a.tool),
  );
  return (
    toolRegistry.getNames().find((t) => !erroredTools.has(t)) ??
    toolRegistry.getNames()[0]
  );
}

export async function supervisorNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  logger.log(`Received input: "${state.input}"`);

  const prompt = buildSupervisorPrompt(state);
  const raw = await invokeLlm(prompt);

  logger.debug(`Raw LLM response:\n${raw}`);

  const iteration = (state.iteration ?? 0) + 1;

  try {
    const decision = extractJson<{
      tool: string;
      params: Record<string, unknown>;
    }>(raw);

    // Guard: prevent re-selecting a tool that previously errored
    const erroredTools = new Set(
      (state.attempts ?? []).filter((a) => a.error).map((a) => a.tool),
    );

    if (erroredTools.has(decision.tool)) {
      const fallback = pickFallbackTool(state);
      logger.warn(
        `LLM selected errored tool "${decision.tool}", overriding to "${fallback}"`,
      );
      return {
        selectedTool: fallback,
        toolParams: decision.params,
        toolInput: JSON.stringify(decision.params),
        iteration,
      };
    }

    logger.log(
      `Decision → tool="${decision.tool}", params=${JSON.stringify(decision.params)}`,
    );
    return {
      selectedTool: decision.tool,
      toolParams: decision.params,
      toolInput: JSON.stringify(decision.params),
      iteration,
    };
  } catch {
    // LLM returned unparseable output — fall back to first working tool
    // using the raw user input as the query param
    const fallback = pickFallbackTool(state);
    const fallbackParams = { query: state.input };
    logger.error(
      `Failed to parse supervisor response, falling back to "${fallback}": ${raw}`,
    );
    return {
      selectedTool: fallback,
      toolParams: fallbackParams,
      toolInput: state.input,
      iteration,
    };
  }
}
