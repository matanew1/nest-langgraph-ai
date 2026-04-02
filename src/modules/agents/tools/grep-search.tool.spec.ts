const mockExecFile = jest.fn();

jest.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

jest.mock('@config/env', () => ({
  env: { agentWorkingDir: '/workspace', toolTimeoutMs: 5000 },
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: (p: string) => `/workspace/${p}`,
}));

import { grepSearchTool } from './grep-search.tool';

describe('grepSearchTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns an error string for an invalid regex pattern', async () => {
    const result = await grepSearchTool.invoke({ pattern: '[invalid' });
    expect(result).toMatch(/ERROR.*invalid.*pattern/i);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('spawns grep for a valid pattern', async () => {
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: (e: null, out: string, err: string) => void) => {
        cb(null, 'src/foo.ts:1:match', '');
      },
    );
    const result = await grepSearchTool.invoke({ pattern: 'foo' });
    expect(mockExecFile).toHaveBeenCalled();
    expect(result).toContain('match');
  });
});
