import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { stat } from 'node:fs/promises';
import { sandboxPath } from '@utils/path.util';

export const statPathTool = tool(
  async ({ path }) => {
    const resolved = sandboxPath(path);
    try {
      const s = await stat(resolved);
      return JSON.stringify(
        {
          path,
          resolved,
          exists: true,
          type: s.isDirectory() ? 'dir' : s.isFile() ? 'file' : 'other',
          size: s.isFile() ? s.size : undefined,
          mtimeMs: s.mtimeMs,
        },
        null,
        2,
      );
    } catch (e) {
      return JSON.stringify(
        {
          path,
          resolved,
          exists: false,
          error: e instanceof Error ? e.message : String(e),
        },
        null,
        2,
      );
    }
  },
  {
    name: 'stat_path',
    description:
      'Return basic filesystem metadata for a path (exists/type/size/mtime).',
    schema: z.object({
      path: z.string().describe('Path to stat'),
    }),
  },
);
