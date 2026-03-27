import { exec } from 'node:child_process';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { sandboxPath } from '@utils/path.util';
import { env } from '@config/env';

const logger = new Logger('RunCommandTool');
const MAX_OUTPUT = 100_000; // 100 KB

export const runCommandTool = tool(
  async ({ command, cwd, timeout }) => {
    const resolvedCwd = sandboxPath(cwd ?? '.');
    const timeoutMs = timeout ?? env.toolTimeoutMs;

    logger.log(`Running: ${command} (cwd=${resolvedCwd})`);

    return new Promise<string>((resolve) => {
      exec(
        command,
        {
          cwd: resolvedCwd,
          timeout: timeoutMs,
          maxBuffer: MAX_OUTPUT,
          env: process.env as NodeJS.ProcessEnv,
        },
        (error, stdout, stderr) => {
          const combined = [
            stdout?.trim(),
            stderr?.trim() ? `STDERR:\n${stderr.trim()}` : '',
          ]
            .filter(Boolean)
            .join('\n')
            .slice(0, MAX_OUTPUT);

          if (error) {
            const exitCode = (error as NodeJS.ErrnoException & { code?: number }).code ?? 1;
            resolve(
              `Exit ${exitCode}:\n${combined || error.message}`,
            );
          } else {
            resolve(combined || '(command completed with no output)');
          }
        },
      );
    });
  },
  {
    name: 'run_command',
    description:
      'Run a shell command inside the agent working directory. Use for npm scripts, builds, tests, or any system command. Returns stdout and stderr combined.',
    schema: z.object({
      command: z.string().describe('Shell command to execute (e.g. "npm test", "ls -la")'),
      cwd: z
        .string()
        .optional()
        .describe(
          'Subdirectory to run in, relative to the agent working directory (default: ".")',
        ),
      timeout: z
        .number()
        .optional()
        .describe('Timeout in milliseconds (default: TOOL_TIMEOUT_MS env var)'),
    }),
  },
);
