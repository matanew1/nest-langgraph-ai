import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { invokeLlm } from '@llm/llm.provider';
import { sandboxPath } from '@utils/path.util';

const logger = new Logger('EditMermaidTool');

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:mermaid)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function sanitizeMermaid(text: string): string {
  return text
    .replace(/(^|\n)\s*graph\s*\[/g, '$1G[')
    .replace(/(^|\n)\s*graph\s*-->/g, '$1G -->')
    .replace(/\bgraph\s*-->/g, 'G -->')
    .replace(/\bgraph\s*\[/g, 'G[');
}

const REFERENCE_STYLE = `flowchart LR
  %% Mirrors src/modules/agents/graph/agent.graph.ts (router-centric, phase-driven)

  START((START))
  END((END))

  SUPERVISOR[SUPERVISOR\\nnodes/supervisor.node.ts]
  RESEARCHER[RESEARCHER\\nnodes/researcher.node.ts]
  PLANNER[PLANNER\\nnodes/planner.node.ts]
  PLAN_VALIDATOR[PLAN_VALIDATOR\\nnodes/plan-validator.node.ts]
  EXECUTE[EXECUTE\\nnodes/execution.node.ts]
  TOOL_RESULT_NORMALIZER[TOOL_RESULT_NORMALIZER\\nnodes/tool-result-normalizer.node.ts]
  CRITIC[CRITIC\\nnodes/critic.node.ts]
  JSON_REPAIR[JSON_REPAIR\\nnodes/json-repair.node.ts]

  ROUTER{ROUTER\\nnodes/decision-router.node.ts\\nroutes by state.phase + flags}

  %% Fixed edges (every node returns to ROUTER)
  START --> SUPERVISOR
  SUPERVISOR --> ROUTER
  RESEARCHER --> ROUTER
  PLANNER --> ROUTER
  PLAN_VALIDATOR --> ROUTER
  EXECUTE --> ROUTER
  TOOL_RESULT_NORMALIZER --> ROUTER
  CRITIC --> ROUTER
  JSON_REPAIR --> ROUTER

  %% Conditional edges from ROUTER
  ROUTER -->|phase = complete OR fatal| END
  ROUTER -->|jsonRepair flag set| JSON_REPAIR

  ROUTER -->|phase = supervisor| SUPERVISOR
  ROUTER -->|phase = research| RESEARCHER
  ROUTER -->|phase = plan| PLANNER
  ROUTER -->|phase = validate_plan| PLAN_VALIDATOR
  ROUTER -->|phase = execute| EXECUTE
  ROUTER -->|phase = normalize_tool_result| TOOL_RESULT_NORMALIZER
  ROUTER -->|phase = judge| CRITIC

  %% Fallback (when phase is route/unknown and no other condition matched)
  ROUTER -->|phase = route / default fallback| SUPERVISOR`;

function looksLikeCodeListingDiagram(text: string): boolean {
  return (
    text.includes('.addNode(') ||
    text.includes('.addEdge(') ||
    text.includes('const graph =') ||
    text.includes('new StateGraph(')
  );
}

const SYSTEM_PROMPT = `You are editing an existing Mermaid diagram.
Return ONLY the full updated Mermaid diagram text (no explanation, no markdown fences).

Rules:
- Preserve intent and existing structure unless the instruction requires change.
- Output must be valid Mermaid syntax.
- Do not output anything except the diagram text.
- IMPORTANT: Node IDs must be simple (letters/numbers/underscores). Do NOT use reserved words like "graph", "end", or "subgraph" as node IDs.
- Prefer conceptual architecture nodes (e.g. SUPERVISOR/ROUTER), not "code listing" nodes like ".addNode(...)" unless explicitly requested.
- Use quoted labels like A["label text"] for any label that contains spaces, punctuation, or parentheses.

House style reference (keep formatting consistent with this style unless asked otherwise):
${REFERENCE_STYLE}
`;

export const editMermaidTool = tool(
  async ({ path, instruction }) => {
    if (extname(path).toLowerCase() !== '.mmd') {
      return 'ERROR: Mermaid file path must end with .mmd';
    }

    const resolved = sandboxPath(path);
    const current = await readFile(resolved, 'utf-8');

    logger.log(`Editing Mermaid file: ${resolved}`);

    const prompt = [
      SYSTEM_PROMPT,
      '',
      'INSTRUCTION:',
      instruction,
      '',
      'CURRENT DIAGRAM:',
      current,
    ].join('\n');

    const raw = (await invokeLlm(prompt)).trim();
    const updated = sanitizeMermaid(stripMarkdownFences(raw));

    // Basic guardrail: updated must not be empty and should start like a Mermaid diagram.
    const start = updated.trimStart();
    if (!start) return 'ERROR: LLM returned empty Mermaid output.';
    const ok =
      start.startsWith('flowchart') ||
      start.startsWith('graph') ||
      start.startsWith('sequenceDiagram') ||
      start.startsWith('stateDiagram') ||
      start.startsWith('classDiagram') ||
      start.startsWith('erDiagram') ||
      start.startsWith('gantt') ||
      start.startsWith('journey') ||
      start.startsWith('mindmap') ||
      start.startsWith('timeline') ||
      start.startsWith('C4Context') ||
      start.startsWith('C4Container') ||
      start.startsWith('C4Component') ||
      start.startsWith('C4Dynamic') ||
      start.startsWith('C4Deployment');

    if (!ok) {
      return `ERROR: LLM did not return Mermaid syntax. Got: ${updated.slice(0, 200)}`;
    }

    if (
      looksLikeCodeListingDiagram(updated) &&
      !instruction.toLowerCase().includes('code listing')
    ) {
      return 'ERROR: Mermaid output looks like a code-listing diagram. Keep a conceptual architecture diagram (nodes/edges), not `.addNode(...)` listings.';
    }

    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(
      resolved,
      updated.endsWith('\n') ? updated : `${updated}\n`,
      'utf-8',
    );
    return `mermaid diagram updated at ${resolved}`;
  },
  {
    name: 'edit_mermaid',
    description:
      'Edit an existing Mermaid (.mmd) diagram file based on an instruction. The tool reads the file, asks the LLM for an updated full diagram, and writes it back.',
    schema: z.object({
      path: z.string().describe('Path to an existing .mmd file'),
      instruction: z
        .string()
        .min(1)
        .describe(
          'What to change in the diagram (add/remove nodes/edges, rename, layout tweaks, etc.)',
        ),
    }),
  },
);
