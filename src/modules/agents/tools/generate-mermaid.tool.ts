import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { invokeLlm } from '@llm/llm.provider';
import { sandboxPath } from '@utils/path.util';
import {
  stripMarkdownFences,
  sanitizeMermaid,
  isLikelyMermaid,
  looksLikeCodeListingDiagram,
  REFERENCE_STYLE,
} from './mermaid.util';

const logger = new Logger('GenerateMermaidTool');

const SYSTEM_PROMPT = `You are a Mermaid diagram author.
Output ONLY Mermaid syntax (no explanation, no markdown fences).

Rules:
- Your output must be a valid Mermaid diagram.
- Do not invent nodes/edges if a SOURCE is provided; SOURCE is authoritative.
- Prefer "flowchart LR" for architecture/workflow unless the user requests otherwise.
- IMPORTANT: Node IDs must be simple (letters/numbers/underscores). Do NOT use reserved words like "graph", "end", or "subgraph" as node IDs.
- Do NOT use parentheses ANYWHERE: no (( )), no [()], no (label), no () in labels.
- Prefer simple quoted rectangles like A["label text"] for labels with spaces, punctuation, or multiple lines.
- Prefer conceptual architecture nodes (e.g. SUPERVISOR/ROUTER), not "code listing" nodes like ".addNode(...)" unless explicitly requested.
- Use actual newlines in multi-line labels (not \\n).

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

