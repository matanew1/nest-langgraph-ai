import type { AgentState } from '../state/agent.state';
import { toolRegistry } from '../tools/tool.registry';
import { env } from '../../config/env';

function truncateAttempts(state: AgentState) {
  const all = state.attempts ?? [];
  return all.slice(-env.promptMaxAttempts);
}

export const buildSupervisorPrompt = (state: AgentState): string => {
  const parts: string[] = [];

  const erroredToolNames = new Set(
    (state.attempts ?? []).filter((a) => a.error).map((a) => a.tool),
  );

  // Build available tools list with param schemas, excluding errored tools
  const availableTools = toolRegistry
    .getToolsWithParams()
    .split('\n')
    .filter((line) => {
      const name = line.match(/^- (\w+):/)?.[1];
      return !name || !erroredToolNames.has(name);
    })
    .join('\n');

  parts.push(`You are a routing agent. Select the best tool and provide the exact parameters it needs.

Rules:
1. Pick the ONE tool whose capability best matches the user's intent.
2. Provide ALL required parameters using the exact field names shown in the tool's params schema.
3. For file operations: derive paths and content directly from the user's request.
4. Return ONLY raw JSON — no explanation, no markdown, no wrapping.

Available tools (name: description, params schema):
${availableTools}

User request:
${state.input}`);

  if (erroredToolNames.size > 0) {
    parts.push(
      `\nEXCLUDED tools (errored — do NOT select):\n${[...erroredToolNames].map((t) => `- ${t}`).join('\n')}`,
    );
  }

  const recentAttempts = truncateAttempts(state);
  if (recentAttempts.length > 0) {
    const attemptLines = recentAttempts.map(
      (a, i) =>
        `${i + 1}. tool="${a.tool}", params=${a.input} → ${a.error ? 'ERROR: ' : ''}${a.result.slice(0, 200)}`,
    );
    parts.push(
      `\nPrevious attempts (learn from these):\n${attemptLines.join('\n')}`,
    );
  }

  parts.push(`\nRespond with ONLY this JSON (use exact param names from the schema):
{"tool":"<tool_name>","params":{<params matching the tool schema exactly>}}`);

  return parts.join('\n');
};

export const buildPlannerPrompt = (state: AgentState): string => {
  const paramHint =
    toolRegistry.getParamHint(state.selectedTool ?? '') ||
    '{"query":"<string>"}';
  const parts: string[] = [];

  parts.push(`You are a planning agent. Refine the tool parameters to maximise the quality of the result.

User request:
${state.input}

Selected tool: ${state.selectedTool}
Tool params schema: ${paramHint}
Current params: ${JSON.stringify(state.toolParams ?? {})}

Instructions:
- Improve every parameter value to be more precise, complete, and correct.
- Keep ALL required fields — never drop a param that the schema requires.
- For file paths: use the path clearly implied or stated in the user's request.
- For "content" params (e.g. write_file): write the full, complete content — not a placeholder.
- Do NOT change the tool itself, only refine its params.`);

  const recentAttempts = truncateAttempts(state);
  if (recentAttempts.length > 0) {
    parts.push(
      `\nPrevious attempts that did not satisfy the request:\n${recentAttempts
        .map(
          (a, i) =>
            `${i + 1}. params=${a.input} → ${a.error ? 'ERROR' : 'insufficient'}: ${a.result.slice(0, 150)}`,
        )
        .join('\n')}\n\nLearn from these failures and produce better params.`,
    );
  }

  parts.push(`\nRespond with ONLY this JSON:
{"params":{<refined params matching the tool schema>},"reasoning":"<one sentence: what you improved and why>"}`);

  return parts.join('\n');
};

export const buildCriticPrompt = (state: AgentState): string => {
  return `You are an evaluation agent. Assess whether the tool result adequately answers the user's request.

Evaluation criteria:
1. The result must directly address the user's question or task.
2. The result must contain substantive information (not an error message or placeholder).
3. The result must be relevant and at least partially useful.
${state.executionPlan ? `4. The execution plan specified: ${state.executionPlan}` : ''}

User request:
${state.input}

Tool used: ${state.selectedTool}

Tool result:
${(state.toolResult ?? '').slice(0, env.criticResultMaxChars)}

Instructions:
- If the result satisfactorily answers the request: set "done" to true and write a clear, well-formatted answer synthesizing the result.
- If the result is an error, a placeholder, or does not address the request: set "done" to false and provide the best partial answer you can from available information.
- ALWAYS include an "answer" field.

Respond with ONLY this JSON (no other text):
{"done": true, "answer": "<your synthesized answer>"}
or
{"done": false, "answer": "<best partial answer or explanation of what's missing>"}`;
};
