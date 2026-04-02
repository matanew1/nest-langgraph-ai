const mockExecFile = jest.fn();

jest.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

jest.mock('@config/env', () => ({
  env: {
    toolTimeoutMs: 5000,
  },
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: (input: string) =>
    `/workspace/${input === '.' ? '' : input}`.replace(/\/$/, ''),
}));

import { runCommandTool } from './run-command.tool';

describe('runCommandTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('prefixes failing commands with ERROR so the agent treats them as failures', async () => {
    mockExecFile.mockImplementation(
      (
        _file: string,
        _args: string[],
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

  it('does not expose parent process env secrets to child', async () => {
    let capturedOptions: Record<string, unknown> = {};

    mockExecFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        options: Record<string, unknown>,
        callback: (error: null, stdout: string, stderr: string) => void,
      ) => {
        capturedOptions = options;
        callback(null, 'ok', '');
      },
    );

    process.env.SECRET_KEY = 'super-secret-token';
    await runCommandTool.invoke({ command: 'echo hello' });
    delete process.env.SECRET_KEY;

    const childEnv = capturedOptions.env as Record<string, string>;
    expect(childEnv).toBeDefined();
    expect(childEnv['SECRET_KEY']).toBeUndefined();
    expect(childEnv['PATH']).toBeDefined();
  });

  it('returns combined stdout on success', async () => {
    mockExecFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, 'hello world', '');
      },
    );

    const result = await runCommandTool.invoke({ command: 'echo hello world' });
    expect(result).toBe('hello world');
  });
});
