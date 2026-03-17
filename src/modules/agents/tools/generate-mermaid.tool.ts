import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { invokeLlm } from '@llm/llm.provider';
import { sandboxPath } from '@utils/path.util';

const logger = new Logger('GenerateMermaidTool');

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:mermaid)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function isLikelyMermaid(text: string): boolean {
  const t = text.trimStart();
  return (
    t.startsWith('flowchart') ||
    t.startsWith('graph') ||
    t.startsWith('sequenceDiagram') ||
    t.startsWith('stateDiagram') ||
    t.startsWith('classDiagram') ||
    t.startsWith('erDiagram') ||
    t.startsWith('gantt') ||
    t.startsWith('journey') ||
    t.startsWith('mindmap') ||
    t.startsWith('timeline') ||
    t.startsWith('C4Context') ||
    t.startsWith('C4Container') ||
    t.startsWith('C4Component') ||
    t.startsWith('C4Dynamic') ||
    t.startsWith('C4Deployment')
  );
}

function sanitizeMermaid(text: string): string {
  // Mermaid "flowchart" grammar uses "graph" as a reserved keyword in some contexts.
  // If an LLM emits a node id named `graph`, many renderers will parse-fail on `graph[...]`.
  // Rewrite it to a safe identifier.
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

const SYSTEM_PROMPT = `You are a Mermaid diagram author.
Output ONLY Mermaid syntax (no explanation, no markdown fences).

Rules:
- Your output must be a valid Mermaid diagram.
- Do not invent nodes/edges if a SOURCE is provided; SOURCE is authoritative.
- Prefer "flowchart LR" for architecture/workflow unless the user requests otherwise.
- IMPORTANT: Node IDs must be simple (letters/numbers/underscores). Do NOT use reserved words like "graph", "end", or "subgraph" as node IDs.
- Prefer conceptual architecture nodes (e.g. SUPERVISOR/ROUTER), not "code listing" nodes like ".addNode(...)" unless explicitly requested.
- Use quoted labels like A["label text"] for any label that contains spaces, punctuation, or parentheses.

House style reference (follow this structure and labeling conventions for architecture/workflow diagrams):
${REFERENCE_STYLE}
`;

export const generateMermaidTool = tool(
  async ({ description, source, path }) => {
    if (extname(path).toLowerCase() !== '.mmd') {
      return 'ERROR: Mermaid diagram path must end with .mmd';
    }

    logger.log(`Generating Mermaid diagram: "${description}" → ${path}`);

    const prompt = [
      SYSTEM_PROMPT,
      '',
      'Diagram requirements:',
      description,
      '',
      source
        ? ['SOURCE (authoritative; do not invent beyond this):', source].join(
            '\n',
          )
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    const raw = (await invokeLlm(prompt)).trim();
    const clean = sanitizeMermaid(stripMarkdownFences(raw));

    if (!isLikelyMermaid(clean)) {
      return `ERROR: LLM did not return Mermaid syntax. Got: ${clean.slice(0, 200)}`;
    }

    if (
      looksLikeCodeListingDiagram(clean) &&
      !description.toLowerCase().includes('code listing')
    ) {
      return 'ERROR: Mermaid output looks like a code-listing diagram. Generate a conceptual architecture diagram (nodes/edges), not `.addNode(...)` listings.';
    }

    const resolved = sandboxPath(path);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(
      resolved,
      clean.endsWith('\n') ? clean : `${clean}\n`,
      'utf-8',
    );

    logger.log(`Mermaid written: ${resolved}`);
    return `mermaid diagram saved to ${resolved} (${clean.length} chars)`;
  },
  {
    name: 'generate_mermaid',
    description:
      'Generate a Mermaid (.mmd) diagram from instructions (and optional authoritative source text) and save it to a file.',
    schema: z.object({
      description: z
        .string()
        .min(1)
        .describe('What diagram to generate and how it should look'),
      source: z
        .string()
        .optional()
        .describe(
          'Optional authoritative source text (e.g., file contents or AST output). If provided, do not invent nodes/edges not supported by the source.',
        ),
      path: z
        .string()
        .describe('Output .mmd file path, e.g. "diagram/agent-graph.mmd"'),
    }),
  },
);
