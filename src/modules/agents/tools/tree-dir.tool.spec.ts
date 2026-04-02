const mockReaddir = jest.fn();
const mockStat = jest.fn();

jest.mock('node:fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  lstat: (...args: unknown[]) => mockStat(...args), // alias
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: (p: string) => p,
}));

import { treeDirTool } from './tree-dir.tool';

describe('treeDirTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('skips symlinks and does not include them in the tree', async () => {
    // Root stat: it's a directory
    mockStat
      .mockResolvedValueOnce({ isDirectory: () => true, isSymbolicLink: () => false }) // root
      .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true, isSymbolicLink: () => true }) // link.ts
      .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false }); // real.ts

    mockReaddir.mockResolvedValueOnce(['link.ts', 'real.ts']);

    const result = await treeDirTool.invoke({ path: '/workspace' });

    expect(result).toContain('real.ts');
    expect(result).not.toContain('link.ts');
  });
});
