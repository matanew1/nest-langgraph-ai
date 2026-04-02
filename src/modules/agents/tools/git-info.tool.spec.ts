const mockExecFile = jest.fn();

jest.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

jest.mock('@config/env', () => ({
  env: { agentWorkingDir: '/workspace', toolTimeoutMs: 5000 },
}));

import { gitInfoTool } from './git-info.tool';

describe('gitInfoTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns an error for args containing shell metacharacters', async () => {
    const result = await gitInfoTool.invoke({ action: 'log', args: 'HEAD; rm -rf /' });
    expect(result).toMatch(/ERROR.*invalid.*arg/i);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects args with backtick injection', async () => {
    const result = await gitInfoTool.invoke({ action: 'show', args: '`whoami`' });
    expect(result).toMatch(/ERROR.*invalid.*arg/i);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('accepts a clean commit hash as args', async () => {
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: (e: null, out: string, err: string) => void) => {
        cb(null, 'commit abc123\nAuthor: ...', '');
      },
    );
    const result = await gitInfoTool.invoke({ action: 'show', args: 'abc123' });
    expect(mockExecFile).toHaveBeenCalled();
    expect(result).toContain('commit abc123');
  });
});
