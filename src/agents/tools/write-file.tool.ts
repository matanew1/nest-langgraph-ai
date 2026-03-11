import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';

const logger = new Logger('WriteFileTool');

export const writeFileTool = tool(
  async ({ path, content }) => {
    const resolved = resolve(path);
    logger.log(`Writing file: ${resolved}`);

    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, content, 'utf-8');

    return `File written successfully: ${resolved} (${content.length} bytes)`;
  },
  {
    name: 'write_file',
    description:
      'Write or create a file on the filesystem with the given content (creates parent directories if needed)',
    schema: z.object({
      path: z.string().describe('Absolute or relative path to the file'),
      content: z.string().describe('Content to write to the file'),
    }),
  },
);
