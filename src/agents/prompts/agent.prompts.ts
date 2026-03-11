import type { AgentState } from '../state/agent.state';
import { toolRegistry } from '../tools/tool.registry';

export const buildSupervisorPrompt = (state: AgentState): string => {
  const parts: string[] = [];

  // Derive which tools are blocked due to errors
  const erroredToolNames = new Set(
    (state.attempts ?? []).filter((a) => a.error).map((a) => a.tool),
  );

  // Build available tools list, excluding errored ones
  const allDescriptions = toolRegistry.getDescriptions();
  const availableLines = allDescriptions
    .split('\n')
    .filter((line) => {
      const name = line.match(/^- (\w+):/)?.[1];
      return !name || !erroredToolNames.has(name);
    })
    .join('\n');

  parts.push(`You are a routing agent. Select the single best tool for the user's request and return a JSON object.

Rules:
1. Pick the ONE tool whose capability best matches the user's intent.
2. If a previous result was insufficient, try a significantly different query or a different tool.
3. Return ONLY raw JSON — no explanation, no markdown, no wrapping.

Available tools:
${availableLines}

User request:
${state.input}`);

  if (erroredToolNames.size > 0) {
    parts.push(
      `\nEXCLUDED tools (failed with errors — do NOT use):\n${[...erroredToolNames].map((t) => `- ${t}`).join('\n')}`,
    );
  }

  if (state.attempts && state.attempts.length > 0) {
    const attemptLines = state.attempts.map(
      (a, i) =>
        `${i + 1}. tool="${a.tool}", input="${a.input}" → ${a.error ? 'ERROR: ' : ''}${a.result}`,
    );
    parts.push(`\nPrevious attempts:\n${attemptLines.join('\n')}`);
  }

  parts.push(`\nRespond with ONLY this JSON:
{"tool":"<tool_name>","input":"<optimized_query>"}`);

  return parts.join('\n');
};

export const buildPlannerPrompt = (state: AgentState): string => {
  const parts: string[] = [];

  parts.push(`You are a planning agent. Your job is to create an optimized execution plan for the selected tool.

Given the user's request and the chosen tool, produce:
1. A refined, optimized query that will yield the best results from the tool.
2. Key aspects to focus on — what specific information matters most.
3. Success criteria — what would make the result satisfactory.

User request:
${state.input}

Selected tool: ${state.selectedTool}
Original query: ${state.toolInput}`);

  if (state.attempts && state.attempts.length > 0) {
    parts.push(
      `\nPrevious attempts that did not satisfy the request:\n${state.attempts
        .map(
          (a, i) =>
            `${i + 1}. tool="${a.tool}", query="${a.input}" → ${a.error ? 'ERROR' : 'insufficient'}`,
        )
        .join('\n')}\n\nLearn from these failures and produce a better plan.`,
    );
  }

  parts.push(`\nRespond with ONLY this JSON (no other text):
{"refinedQuery":"<optimized query for the tool>","focus":"<what to focus on in the results>","successCriteria":"<what makes the result good enough>"}`);

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
${state.toolResult}

Instructions:
- If the result satisfactorily answers the request: set "done" to true and write a clear, well-formatted answer synthesizing the result.
- If the result is an error, a placeholder, or does not address the request: set "done" to false and provide the best partial answer you can from available information.
- ALWAYS include an "answer" field.

Respond with ONLY this JSON (no other text):
{"done": true, "answer": "<your synthesized answer>"}
or
{"done": false, "answer": "<best partial answer or explanation of what's missing>"}`;
};
