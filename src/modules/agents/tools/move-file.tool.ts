import { rename, mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { sandboxPath } from '@utils/path.util';

const logger = new Logger('MoveFileTool');

export const moveFileTool = tool(
  async ({ from, to }) => {
    const resolvedFrom = sandboxPath(from);
    const resolvedTo = sandboxPath(to);

    // Warn if destination already exists to prevent silent overwrites
    try {
      await stat(resolvedTo);
      return `ERROR: destination "${to}" already exists. Delete or rename it first.`;
    } catch (err) {
      // ENOENT means destination does not exist — that's what we want
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        return `ERROR: could not check destination — ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    logger.log(`Moving: ${resolvedFrom} → ${resolvedTo}`);

    try {
      await mkdir(dirname(resolvedTo), { recursive: true });
      await rename(resolvedFrom, resolvedTo);
      return `Moved: ${resolvedFrom} → ${resolvedTo}`;
    } catch (err) {
      return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: 'move_file',
    description:
      'Move or rename a file or directory. Creates destination parent directories if needed. Returns an error if the destination already exists.',
    schema: z.object({
      from: z.string().describe('Source path (file or directory to move/rename)'),
      to: z.string().describe('Destination path'),
    }),
  },
);
