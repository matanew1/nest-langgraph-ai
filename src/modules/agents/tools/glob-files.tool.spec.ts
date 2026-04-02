const mockReaddir = jest.fn();
const mockLstat = jest.fn();

jest.mock('node:fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  lstat: (...args: unknown[]) => mockLstat(...args),
  stat: (...args: unknown[]) => mockLstat(...args), // alias for current code
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: (p: string) => `/workspace/${p === '.' ? '' : p}`.replace(/\/$/, ''),
}));

import { globFilesTool } from './glob-files.tool';

describe('globFilesTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not follow symlinks during walk', async () => {
    mockReaddir.mockResolvedValueOnce(['real.ts', 'link.ts']);
    mockLstat.mockImplementation((p: string) => {
      if (p.endsWith('link.ts')) {
        // isFile returns true so only isSymbolicLink check can exclude it
        return Promise.resolve({ isDirectory: () => false, isFile: () => true, isSymbolicLink: () => true });
      }
      return Promise.resolve({ isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false });
    });

    const result = await globFilesTool.invoke({ root: '.', extensions: ['.ts'] });
    expect(result).toContain('real.ts');
    expect(result).not.toContain('link.ts');
  });
});
