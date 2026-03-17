import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { sandboxPath } from '@utils/path.util';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);

async function walk(
  dir: string,
  extensions: Set<string>,
  maxResults: number,
  acc: string[],
): Promise<void> {
  if (acc.length >= maxResults) return;
  const entries = await readdir(dir);
  for (const entry of entries) {
    if (acc.length >= maxResults) return;
    const full = join(dir, entry);
    const s = await stat(full);
    if (s.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      await walk(full, extensions, maxResults, acc);
    } else if (s.isFile()) {
      const dot = entry.lastIndexOf('.');
      const ext = dot >= 0 ? entry.slice(dot).toLowerCase() : '';
      if (extensions.size === 0 || extensions.has(ext)) acc.push(full);
    }
  }
}

export const globFilesTool = tool(
  async ({ root, extensions, maxResults }) => {
    const resolvedRoot = sandboxPath(root ?? '.');
    const exts = new Set((extensions ?? []).map((e) => e.toLowerCase()));
    const acc: string[] = [];
    await walk(resolvedRoot, exts, maxResults ?? 200, acc);
    if (acc.length === 0) return 'No files found.';
    return acc.slice(0, maxResults ?? 200).join('\n');
  },
  {
    name: 'glob_files',
    description:
      'List files recursively under a directory, optionally filtered by extensions. Skips node_modules, .git, dist, coverage.',
    schema: z.object({
      root: z
        .string()
        .optional()
        .describe('Root directory to search (default: ".")'),
      extensions: z
        .array(z.string())
        .optional()
        .describe('File extensions to include, e.g. [".ts",".tsx"]'),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(2000)
        .optional()
        .default(200)
        .describe('Maximum number of files to return'),
    }),
  },
);

