import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { sandboxPath } from '@utils/path.util';

const logger = new Logger('FilePatchTool');

export const filePatchTool = tool(
  async ({
    path,
    find,
    replace,
    backup = true,
    docString,
    docPosition = 'before',
  }: {
    path: string;
    find: string;
    replace: string;
    backup?: boolean;
    docString?: string;
    docPosition?: 'before' | 'after' | 'prepend';
  }) => {
    const resolved = sandboxPath(path);
    logger.log(
      `Patching "${resolved}": find ${find.length} chars → replace ${replace.length} chars`
    );

    let content: string;
    try {
      content = await readFile(resolved, 'utf-8');
    } catch {
      return `ERROR: file "${path}" does not exist or cannot be read.`;
    }

    if (!content.includes(find)) {
      return `ERROR: the exact "find" string was not found in "${path}". The file has ${content.length} chars. Ensure the find string matches exactly (including whitespace).`;
    }

    let updated = content.replace(find, replace);

    // Add documentation if provided
    if (docString) {
      switch (docPosition) {
        case 'prepend':
          updated = `${docString}\n${updated}`;
          break;
        case 'before':
          updated = updated.replace(replace, `${docString}\n${replace}`);
          break;
        case 'after':
          updated = updated.replace(replace, `${replace}\n${docString}`);
          break;
        default:
          updated = updated; // fallback, no change
      }
      logger.log(`Documentation added at position "${docPosition}"`);
    }

    // Optional backup
    if (backup) {
      const backupPath = `${resolved}.bak`;
      try {
        await copyFile(resolved, backupPath);
        logger.log(`Backup created → ${backupPath}`);
      } catch (err) {
        logger.warn(`Could not create backup: ${(err as Error).message}`);
      }
    }

    // Rewrite the full file
    await writeFile(resolved, updated, 'utf-8');
    logger.log(`File rewritten → ${resolved}`);

    const linesChanged = find.split('\n').length;
    return `Patched and rewrote "${path}" successfully (${linesChanged} line${linesChanged === 1 ? '' : 's'} affected).`;
  },
  {
    name: 'file_patch_rewrite_doc',
    description:
      'Find and replace text within a file, rewrite the entire file, optionally add documentation comments at top, before, or after the patched section. Creates a backup by default.',
    schema: z.object({
      path: z.string().describe('Path to the file to patch'),
      find: z.string().describe('Exact text to find in the file'),
      replace: z.string().describe('Replacement text'),
      backup: z
        .boolean()
        .optional()
        .describe('Whether to create a backup before rewriting (default true)'),
      docString: z
        .string()
        .optional()
        .describe('Optional documentation string or comment to add'),
      docPosition: z
        .enum(['before', 'after', 'prepend'])
        .optional()
        .describe(
          'Where to insert the documentation: before the patched section, after, or at the top of the file (default: before)',
        ),
    }),
  }
);