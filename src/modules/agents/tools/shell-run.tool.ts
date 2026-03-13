import { exec } from 'node:child_process';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { env } from '@config/env';

const logger = new Logger('ShellRunTool');

const MAX_OUTPUT = 50_000;

export const shellRunTool = tool(
  async ({ command }) => {
    logger.log(`Running command: ${command}`);

    return new Promise<string>((resolve) => {
      const child = exec(command, {
        cwd: env.agentWorkingDir,
        timeout: env.toolTimeoutMs,
        maxBuffer: MAX_OUTPUT,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (chunk: string) => (stdout += chunk));
      child.stderr?.on('data', (chunk: string) => (stderr += chunk));

      child.on('close', (code) => {
        const exitCode = code ?? 0;
        if (exitCode !== 0) {
          // Failure: include exit code and stderr so the agent knows what went wrong
          const err = (stderr || stdout || '(no output)').slice(0, MAX_OUTPUT);
          resolve(`ERROR (exit ${exitCode}):\n${err}`);
        } else {
          // Success: return clean stdout only — no prefix, so __PREVIOUS_RESULT__ is usable directly
          resolve((stdout || '(no output)').slice(0, MAX_OUTPUT));
        }
      });

      child.on('error', (err) => {
        resolve(`error: ${err.message}`);
      });
    });
  },
  {
    name: 'shell_run',
    description:
      'Execute a shell command in the project working directory and return its stdout/stderr output. Use for commands like `tree`, `find`, `cat`, `ls`, `wc`, etc.',
    schema: z.object({
      command: z.string().describe('The shell command to execute'),
    }),
  },
);
