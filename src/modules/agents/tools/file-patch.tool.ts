import { readFile, writeFile } from 'node:fs/promises';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { sandboxPath } from '@utils/path.util';

const logger = new Logger('FilePatchTool');

export const filePatchTool = tool(
  async ({ path, find, replace }) => {
    const resolved = sandboxPath(path);
    logger.log(`Patching "${resolved}": find ${find.length} chars → replace ${replace.length} chars`);

    let content: string;
    try {
      content = await readFile(resolved, 'utf-8');
    } catch {
      return `ERROR: file "${path}" does not exist or cannot be read.`;
    }

    if (!content.includes(find)) {
      return `ERROR: the exact "find" string was not found in "${path}". The file has ${content.length} chars. Make sure the find string matches exactly (including whitespace).`;
    }

    const updated = content.replace(find, replace);
    await writeFile(resolved, updated, 'utf-8');

    const linesChanged = find.split('\n').length;
    return `Patched "${path}" successfully (${linesChanged} line${linesChanged === 1 ? '' : 's'} affected).`;
  },
  {
    name: 'file_patch',
    description:
      'Find and replace text within a file. Safer than rewriting the whole file — only the matched section changes. The "find" string must match exactly.',
    schema: z.object({
      path: z.string().describe('Path to the file to patch'),
      find: z.string().describe('Exact text to find in the file'),
      replace: z.string().describe('Replacement text'),
    }),
  },
);
