import { execFile } from 'node:child_process';
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
    // Validate pattern is a valid regex before spawning grep
    try {
      new RegExp(pattern);
    } catch {
      return `ERROR: invalid regex pattern — ${pattern}`;
    }

    const resolved = sandboxPath(path ?? '.');

    const args = ['-rn', '--color=never'];

    // Exclude common noise directories
    for (const dir of EXCLUDE_DIRS) {
      args.push(`--exclude-dir=${dir}`);
    }

    if (glob) {
      args.push(`--include=${glob}`);
    }

    args.push('-e', pattern, resolved);
    logger.log(
      `Searching: pattern="${pattern}" path="${resolved}" glob="${glob ?? '*'}"`,
    );

    return new Promise<string>((resolve) => {
      execFile(
        'grep',
        args,
        {
          cwd: env.agentWorkingDir,
          timeout: env.toolTimeoutMs,
          maxBuffer: MAX_OUTPUT,
        },
        (error, stdout, stderr) => {
          if (stdout && stdout.trim().length > 0) {
            const lines = stdout.trim().split('\n');
            const header = `Found ${lines.length} match${lines.length === 1 ? '' : 'es'}:\n`;
            resolve((header + stdout.trim()).slice(0, MAX_OUTPUT));
            return;
          }

          if (error && 'code' in error && error.code !== 1) {
            resolve(`ERROR: ${stderr || error.message}`.slice(0, MAX_OUTPUT));
          } else {
            resolve(`No matches found for pattern "${pattern}"`);
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
