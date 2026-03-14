import { execFile } from 'node:child_process';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { env } from '@config/env';

const logger = new Logger('GitInfoTool');

const MAX_OUTPUT = 50_000;

const ALLOWED_ACTIONS = ['status', 'log', 'diff', 'branch', 'show'] as const;

type GitAction = (typeof ALLOWED_ACTIONS)[number];

/**
 * Build a safe args array for execFile('git', ...).
 * Using execFile avoids shell interpretation — args are passed directly
 * to the git process, so injection via `args` is not possible.
 */
function buildArgs(action: GitAction, args: string): string[] {
  // Split user-supplied args on whitespace; each token is a separate argument
  const extra = args.trim().split(/\s+/).filter(Boolean);

  switch (action) {
    case 'status':
      return ['status', '--short'];
    case 'log':
      return ['log', '--oneline', '-20', ...extra];
    case 'diff':
      return ['diff', ...(extra.length ? extra : ['HEAD'])];
    case 'branch':
      return ['branch', '-a'];
    case 'show':
      return ['show', '--stat', ...(extra.length ? extra : ['HEAD'])];
  }
}

export const gitInfoTool = tool(
  async ({ action, args }) => {
    if (!ALLOWED_ACTIONS.includes(action as GitAction)) {
      return `ERROR: unknown action "${action}". Allowed: ${ALLOWED_ACTIONS.join(', ')}`;
    }

    const gitArgs = buildArgs(action as GitAction, args ?? '');
    logger.log(`git ${action}: git ${gitArgs.join(' ')}`);

    return new Promise<string>((resolve) => {
      execFile(
        'git',
        gitArgs,
        {
          cwd: env.agentWorkingDir,
          timeout: env.toolTimeoutMs,
          maxBuffer: MAX_OUTPUT,
        },
        (error, stdout, stderr) => {
          if (error) {
            resolve(`ERROR: ${stderr || error.message}`.slice(0, MAX_OUTPUT));
          } else {
            resolve((stdout || '(no output)').slice(0, MAX_OUTPUT));
          }
        },
      );
    });
  },
  {
    name: 'git_info',
    description:
      'Query git repository information. Actions: status (working tree changes), log (recent commits), diff (show changes), branch (list branches), show (commit details).',
    schema: z.object({
      action: z.string().describe('One of: status, log, diff, branch, show'),
      args: z
        .string()
        .optional()
        .describe(
          'Optional extra arguments (e.g. file path for diff, commit hash for show)',
        ),
    }),
  },
);
