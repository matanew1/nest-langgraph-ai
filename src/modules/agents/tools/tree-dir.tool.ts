import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { sandboxPath } from '@utils/path.util';

const logger = new Logger('TreeDirTool');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);
const MAX_DEPTH = 10;

async function buildTree(
  dirPath: string,
  prefix: string,
  depth: number,
): Promise<string[]> {
  if (depth > MAX_DEPTH) return [`${prefix}… (max depth reached)`];

  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    return [`${prefix}[unreadable]`];
  }

  entries.sort((a, b) => a.localeCompare(b));
  const lines: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const name = entries[i];
    const isLast = i === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? prefix + '    ' : prefix + '│   ';
    const fullPath = join(dirPath, name);

    let s;
    try {
      s = await stat(fullPath);
    } catch {
      lines.push(`${prefix}${connector}${name} [unreadable]`);
      continue;
    }

    if (s.isDirectory()) {
      lines.push(`${prefix}${connector}${name}/`);
      if (!SKIP_DIRS.has(name)) {
        const children = await buildTree(fullPath, childPrefix, depth + 1);
        lines.push(...children);
      }
    } else {
      lines.push(`${prefix}${connector}${name}`);
    }
  }

  return lines;
}

export const treeDirTool = tool(
  async ({ path }) => {
    const resolved = sandboxPath(path);
    logger.log(`Building tree for: ${resolved}`);

    // Validate the path exists and is a directory
    let s;
    try {
      s = await stat(resolved);
    } catch {
      return `ERROR: path "${path}" does not exist. Use "." for the project root directory.`;
    }
    if (!s.isDirectory()) {
      return `ERROR: path "${path}" is a file, not a directory. This tool requires a directory path. Use "." for the project root directory.`;
    }

    const lines = [resolved, ...(await buildTree(resolved, '', 0))];
    return lines.join('\n');
  },
  {
    name: 'tree_dir',
    description:
      'Recursively list the entire directory tree (all files and folders) rooted at the given path, formatted like the Unix `tree` command. Skips node_modules, .git, dist, and coverage.',
    schema: z.object({
      path: z
        .string()
        .describe('Absolute or relative path to the root directory'),
    }),
  },
);
