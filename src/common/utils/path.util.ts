import { env } from '@config/env';
import { resolve } from 'node:path';

/**
 * Resolve `inputPath` and verify it sits inside `AGENT_WORKING_DIR`.
 * Throws a descriptive error if the path escapes the sandbox — this prevents
 * the LLM from accidentally (or maliciously) reading /etc/passwd, SSH keys, etc.
 *
 * @returns The resolved absolute path if it is safe.
 */
export function sandboxPath(inputPath: string): string {
  const root = resolve(env.agentWorkingDir);
  const target = resolve(inputPath);

  // A valid path must be the root itself OR start with "root/"
  if (target !== root && !target.startsWith(root + '/')) {
    throw new Error(
      `Access denied: "${inputPath}" resolves to "${target}", which is outside ` +
        `the allowed working directory "${root}". ` +
        `Set AGENT_WORKING_DIR to expand the sandbox.`,
    );
  }

  return target;
}
