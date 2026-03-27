import { rename, mkdir } from 'node:fs/promises';
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
      'Move or rename a file or directory. Creates destination parent directories if needed.',
    schema: z.object({
      from: z.string().describe('Source path (file or directory to move/rename)'),
      to: z.string().describe('Destination path'),
    }),
  },
);
