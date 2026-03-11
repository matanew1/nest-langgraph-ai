import { readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';

const logger = new Logger('ListDirTool');

export const listDirTool = tool(
  async ({ path }) => {
    const resolved = resolve(path);
    logger.log(`Listing directory: ${resolved}`);

    const entries = await readdir(resolved);
    const lines: string[] = [];

    for (const entry of entries) {
      const fullPath = join(resolved, entry);
      const stats = await stat(fullPath);
      const type = stats.isDirectory() ? 'dir' : 'file';
      const size = stats.isFile() ? ` (${stats.size} bytes)` : '';
      lines.push(`[${type}] ${entry}${size}`);
    }

    if (lines.length === 0) return 'Directory is empty.';
    return lines.join('\n');
  },
  {
    name: 'list_dir',
    description:
      'List the contents of a directory, showing file names, types (file/dir), and sizes',
    schema: z.object({
      path: z
        .string()
        .describe('Absolute or relative path to the directory'),
    }),
  },
);
