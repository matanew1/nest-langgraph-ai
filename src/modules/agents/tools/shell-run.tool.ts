import { exec } from 'node:child_process';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { env } from '@config/env';

const logger = new Logger('ShellRunTool');

const MAX_OUTPUT = 50_000;

// Patterns that could cause irreversible damage or exfiltration
const DENIED_PATTERNS = [
  /\brm\s+-rf?\b/,           // rm -rf / rm -r
  /\brmdir\b/,               // rmdir
  /\bdd\b/,                  // dd (disk operations)
  /\bmkfs\b/,                // format filesystems
  /\bformat\b/,              // format
  /\bshred\b/,               // shred files
  /\bcurl\b/,                // outbound network
  /\bwget\b/,                // outbound network
  /\bnc\b|\bnetcat\b/,       // netcat
  /\bssh\b|\bscp\b/,        // remote access
  /\bchmod\s+777\b/,         // world-writable
  /\bsudo\b|\bsu\b/,         // privilege escalation
  /\bpasswd\b/,              // password changes
  />/,                       // output redirection (use write_file instead)
  /\|\s*bash\b|\|\s*sh\b/,  // piping to shell
];

function isDenied(command: string): string | null {
  for (const pattern of DENIED_PATTERNS) {
    if (pattern.test(command)) {
      return `Command blocked by security policy (matched: ${pattern})`;
    }
  }
  return null;
}

export const shellRunTool = tool(
  async ({ command }) => {
    const denied = isDenied(command);
    if (denied) {
      logger.warn(`Blocked command: ${command} — ${denied}`);
      return `ERROR: ${denied}`;
    }

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
