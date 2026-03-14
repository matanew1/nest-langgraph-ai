import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { sandboxPath } from '@utils/path.util';

const logger = new Logger('WriteFileTool');

const MAX_CONTENT_SIZE = 10_000_000; // 10 MB guard against runaway LLM output

export const writeFileTool = tool(
  async ({ path, content }) => {
    if (content.length > MAX_CONTENT_SIZE) {
      return `ERROR: content is too large (${content.length} chars). Maximum allowed is ${MAX_CONTENT_SIZE} chars.`;
    }

    const resolved = sandboxPath(path);
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
