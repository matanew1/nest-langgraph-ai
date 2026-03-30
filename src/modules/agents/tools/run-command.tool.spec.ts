const mockExec = jest.fn();

jest.mock('node:child_process', () => ({
  exec: (...args: unknown[]) => mockExec(...args),
}));

jest.mock('@config/env', () => ({
  env: {
    toolTimeoutMs: 5000,
  },
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: (input: string) => `/workspace/${input === '.' ? '' : input}`.replace(
    /\/$/,
    '',
  ),
}));

import { runCommandTool } from './run-command.tool';

describe('runCommandTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('prefixes failing commands with ERROR so the agent treats them as failures', async () => {
    mockExec.mockImplementation(
      (
        _command: string,
        _options: unknown,
        callback: (
          error: NodeJS.ErrnoException | null,
          stdout: string,
          stderr: string,
        ) => void,
      ) => {
        callback(
          Object.assign(new Error('Command failed'), { code: 2 }),
          '',
          'tests failed',
        );
      },
    );

    const result = await runCommandTool.invoke({ command: 'npm test' });

    expect(result).toBe(
      'ERROR: Command exited with code 2\nSTDERR:\ntests failed',
    );
  });
});
