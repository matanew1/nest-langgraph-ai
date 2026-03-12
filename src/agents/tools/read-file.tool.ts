import { readFile } from 'node:fs/promises';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { sandboxPath } from '../../utils/path.util';

const logger = new Logger('ReadFileTool');

const MAX_SIZE = 100_000; // 100 KB limit to keep LLM context manageable

export const readFileTool = tool(
  async ({ path }) => {
    const resolved = sandboxPath(path);
    logger.log(`Reading file: ${resolved}`);

    const content = await readFile(resolved, 'utf-8');

    if (content.length > MAX_SIZE) {
      return (
        content.slice(0, MAX_SIZE) +
        `\n\n… [truncated – file is ${content.length} bytes]`
      );
    }

    return content;
  },
  {
    name: 'read_file',
    description:
      'Read the contents of a file from the filesystem given its path',
    schema: z.object({
      path: z.string().describe('Absolute or relative path to the file'),
    }),
  },
);
