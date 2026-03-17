import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { sandboxPath } from '@utils/path.util';

const logger = new Logger('ReadMermaidTool');

export const readMermaidTool = tool(
  async ({ path }) => {
    if (extname(path).toLowerCase() !== '.mmd') {
      return 'ERROR: Mermaid file path must end with .mmd';
    }

    const resolved = sandboxPath(path);
    logger.log(`Reading Mermaid file: ${resolved}`);
    const content = await readFile(resolved, 'utf-8');
    return content;
  },
  {
    name: 'read_mermaid',
    description: 'Read a Mermaid (.mmd) file and return its contents.',
    schema: z.object({
      path: z.string().describe('Path to a .mmd file'),
    }),
  },
);

