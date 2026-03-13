import { exec } from 'node:child_process';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { env } from '@config/env';

const logger = new Logger('GitInfoTool');

const MAX_OUTPUT = 50_000;

const ALLOWED_ACTIONS = [
  'status',
  'log',
  'diff',
  'branch',
  'show',
] as const;

type GitAction = (typeof ALLOWED_ACTIONS)[number];

/** Map user-friendly action names to safe git commands */
function buildCommand(action: GitAction, args: string): string {
  switch (action) {
    case 'status':
      return 'git status --short';
    case 'log':
      return `git log --oneline -20 ${args}`.trim();
    case 'diff':
      return `git diff ${args || 'HEAD'}`.trim();
    case 'branch':
      return 'git branch -a';
    case 'show':
      return `git show --stat ${args || 'HEAD'}`.trim();
  }
}

export const gitInfoTool = tool(
  async ({ action, args }) => {
    if (!ALLOWED_ACTIONS.includes(action as GitAction)) {
      return `Error: unknown action "${action}". Allowed: ${ALLOWED_ACTIONS.join(', ')}`;
    }

    const command = buildCommand(action as GitAction, args ?? '');
    logger.log(`git ${action}: ${command}`);

    return new Promise<string>((resolve) => {
      exec(
        command,
        { cwd: env.agentWorkingDir, timeout: env.toolTimeoutMs, maxBuffer: MAX_OUTPUT },
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
      action: z
        .string()
        .describe('One of: status, log, diff, branch, show'),
      args: z
        .string()
        .optional()
        .describe('Optional extra arguments (e.g. file path for diff, commit hash for show)'),
    }),
  },
);
