import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { sandboxPath } from '../../utils/path.util';

const logger = new Logger('ListDirTool');

export const listDirTool = tool(
  async ({ path }) => {
    const resolved = sandboxPath(path);
    logger.log(`Listing directory: ${resolved}`);

    const entries = await readdir(resolved);
    if (entries.length === 0) return 'Directory is empty.';

    // Stat all entries in parallel instead of sequentially
    const stats = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = join(resolved, entry);
        const s = await stat(fullPath);
        return {
          entry,
          type: s.isDirectory() ? 'dir' : 'file',
          size: s.isFile() ? s.size : null,
        };
      }),
    );

    return stats
      .map(
        ({ entry, type, size }) =>
          `[${type}] ${entry}${size !== null ? ` (${size} bytes)` : ''}`,
      )
      .join('\n');
  },
  {
    name: 'list_dir',
    description:
      'List the contents of a directory, showing file names, types (file/dir), and sizes',
    schema: z.object({
      path: z.string().describe('Absolute or relative path to the directory'),
    }),
  },
);
