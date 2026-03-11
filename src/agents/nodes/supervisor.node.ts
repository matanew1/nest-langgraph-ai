import { Logger } from '@nestjs/common';
import { llm } from '@providers/llm.provider';
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

  const res = await llm.invoke(prompt);
  const raw = res.content as string;

  logger.debug(`Raw LLM response:\n${raw}`);

  const iteration = (state.iteration ?? 0) + 1;

  try {
    const decision = extractJson<{ tool: string; input: string }>(raw);

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
        toolInput: decision.input,
        iteration,
      };
    }

    logger.log(
      `Decision → tool="${decision.tool}", input="${decision.input}"`,
    );
    return {
      selectedTool: decision.tool,
      toolInput: decision.input,
      iteration,
    };
  } catch (error) {
    logger.error(`Failed to parse supervisor response: ${raw}`);
    return {
      selectedTool: pickFallbackTool(state),
      toolInput: state.input,
      iteration,
    };
  }
}
