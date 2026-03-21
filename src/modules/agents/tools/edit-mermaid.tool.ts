import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

const logger = new Logger('EditMermaidTool');

const SYSTEM_PROMPT = `You are editing an existing Mermaid diagram.
Return ONLY the full updated Mermaid diagram text (no explanation, no markdown fences).

Rules:
- Preserve intent and existing structure unless the instruction requires change.
- Output must be valid Mermaid syntax.
- Do not output anything except the diagram text.
- IMPORTANT: Node IDs must be simple (letters/numbers/underscores). Do NOT use reserved words like "graph", "end", or "subgraph" as node IDs.
- For parallel flows or convergence (multiple nodes to one), use separate lines: F --> I
G --> I
H --> I
NEVER use '&' between nodes like "F & G & H --> I".
- Prefer conceptual architecture nodes (e.g. SUPERVISOR/ROUTER), not "code listing" nodes like ".addNode(...)" unless explicitly requested.
- Node labels: Use A["text with spaces, (), @, punctuation"] for any special chars.
- Link labels: Use -->|"safe label"| or -->|"@Global() & @Module() quoted"| for decorators/special chars (quote if (, ), @, | ).

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

    if (!updated.trimStart()) {
      return 'ERROR: LLM returned empty Mermaid output.';
    }

    if (!isLikelyMermaid(updated)) {
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
