const mockReaddir = jest.fn();
const mockLstat = jest.fn();
const mockReadFile = jest.fn();
const mockStat = jest.fn();

jest.mock('node:fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  lstat: (...args: unknown[]) => mockLstat(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  stat: (...args: unknown[]) => mockStat(...args),
}));

jest.mock('@config/env', () => ({
  env: { agentWorkingDir: '/workspace' },
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: () => '/workspace',
}));

import { repoImpactRadarTool } from './repo-impact-radar.tool';

describe('repoImpactRadarTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('skips symlinks during directory walk', async () => {
    mockReaddir.mockResolvedValue(['real.ts', 'link.ts']);
    mockLstat.mockImplementation((_p: string) => {
      if (_p.includes('link.ts')) {
        return Promise.resolve({ isDirectory: () => false, isFile: () => false, isSymbolicLink: () => true });
      }
      return Promise.resolve({ isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false, size: 10 });
    });
    mockStat.mockResolvedValue({ size: 10 });
    mockReadFile.mockResolvedValue('content');

    await repoImpactRadarTool.invoke({ objective: 'real', hints: ['real'] });

    // readFile should only be called for real.ts, not link.ts
    const readFileCalls = (mockReadFile as jest.Mock).mock.calls.map((c) => c[0] as string);
    expect(readFileCalls.some((p) => p.includes('link.ts'))).toBe(false);
  });
});
