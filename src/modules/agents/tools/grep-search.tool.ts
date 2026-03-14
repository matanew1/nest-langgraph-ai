import { exec } from 'node:child_process';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { sandboxPath } from '@utils/path.util';
import { env } from '@config/env';

const logger = new Logger('GrepSearchTool');

const MAX_OUTPUT = 50_000;

/** Directories always excluded from search results */
const EXCLUDE_DIRS = ['node_modules', 'dist', '.git', 'coverage'];

export const grepSearchTool = tool(
  async ({ pattern, path, glob }) => {
    const resolved = sandboxPath(path ?? '.');

    // Build grep command with safe flags
    const parts = ['grep', '-rn', '--color=never'];

    // Exclude common noise directories
    for (const dir of EXCLUDE_DIRS) {
      parts.push(`--exclude-dir="${dir}"`);
    }

    if (glob) {
      parts.push(`--include="${glob}"`);
    }

    parts.push('-e', `"${pattern.replace(/"/g, '\\"')}"`, `"${resolved}"`);

    const command = parts.join(' ');
    logger.log(`Searching: pattern="${pattern}" path="${resolved}" glob="${glob ?? '*'}"`);

    return new Promise<string>((resolve) => {
      exec(
        command,
        { cwd: resolved, timeout: env.toolTimeoutMs, maxBuffer: MAX_OUTPUT },
        (error, stdout) => {
          if (!stdout || stdout.trim().length === 0) {
            resolve(`No matches found for pattern "${pattern}"`);
          } else {
            const lines = stdout.trim().split('\n');
            const header = `Found ${lines.length} match${lines.length === 1 ? '' : 'es'}:\n`;
            resolve((header + stdout.trim()).slice(0, MAX_OUTPUT));
          }
        },
      );
    });
  },
  {
    name: 'grep_search',
    description:
      'Search for a text pattern across files in a directory. Returns matching lines with file paths and line numbers. Automatically excludes node_modules, dist, .git, and coverage directories.',
    schema: z.object({
      pattern: z.string().describe('Text or regex pattern to search for'),
      path: z
        .string()
        .optional()
        .describe('Directory to search in (default: project root ".")'),
      glob: z
        .string()
        .optional()
        .describe('File glob filter, e.g. "*.ts" or "*.json"'),
    }),
  },
);
