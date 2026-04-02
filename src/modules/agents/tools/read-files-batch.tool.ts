import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { sandboxPath } from '@utils/path.util';

const MAX_FILES = 25;
const MAX_PER_FILE = 80_000;
const MAX_TOTAL = 400_000;

export const readFilesBatchTool = tool(
  async ({ paths }) => {
    const unique = Array.from(new Set(paths)).slice(0, MAX_FILES);
    const outputs: string[] = [];
    let total = 0;

    for (const p of unique) {
      const resolved = sandboxPath(p);
      let block: string;

      try {
        const content = await readFile(resolved, 'utf-8');
        const truncated = content.length > MAX_PER_FILE;
        const chunk = truncated ? content.slice(0, MAX_PER_FILE) : content;
        block = `=== ${p} ===\n${chunk}${truncated ? '\n… [truncated]' : ''}\n`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        block = `=== ${p} ===\nERROR: could not read file — ${msg}\n`;
      }
      total += block.length;
      if (total > MAX_TOTAL) {
        outputs.push('… [batch truncated: total output limit reached]');
        break;
      }
      outputs.push(block);
    }

    return outputs.join('\n');
  },
  {
    name: 'read_files_batch',
    description:
      'Read multiple files in one call (bounded). Returns a concatenated text with file headers.',
    schema: z.object({
      paths: z
        .array(z.string())
        .min(1)
        .max(MAX_FILES)
        .describe('List of file paths to read'),
    }),
  },
);
