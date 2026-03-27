import { unlink, rmdir, stat } from 'node:fs/promises';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { sandboxPath } from '@utils/path.util';

const logger = new Logger('DeleteFileTool');

export const deleteFileTool = tool(
  async ({ path }) => {
    const resolved = sandboxPath(path);
    logger.log(`Deleting: ${resolved}`);

    try {
      const stats = await stat(resolved);
      if (stats.isDirectory()) {
        await rmdir(resolved);
        return `Directory deleted: ${resolved}`;
      }
      await unlink(resolved);
      return `File deleted: ${resolved}`;
    } catch (err) {
      return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: 'delete_file',
    description:
      'Delete a file from the filesystem. Can also delete an empty directory. Use with caution — this operation is irreversible.',
    schema: z.object({
      path: z
        .string()
        .describe('Path to the file or empty directory to delete'),
    }),
  },
);
