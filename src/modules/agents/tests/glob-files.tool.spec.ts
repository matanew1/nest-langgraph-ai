import { globFilesTool } from '../tools/glob-files.tool';

jest.mock('@config/env', () => ({
  env: {
    agentWorkingDir: '/tmp',
    toolTimeoutMs: 5000,
  },
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: (p: string) => {
    const { resolve } = require('node:path');
    const root = '/tmp';
    const target = p === '.' ? root : resolve(p);
    if (target !== root && !target.startsWith(root + '/')) {
      throw new Error(`Access denied: "${p}" is outside the sandbox "${root}"`);
    }
    return target;
  },
}));

// Mock fs/promises so we don't touch the real filesystem
jest.mock('node:fs/promises', () => ({
  readdir: jest.fn(),
  stat: jest.fn(),
}));

import { readdir, stat } from 'node:fs/promises';

const mockedReaddir = readdir as jest.MockedFunction<typeof readdir>;
const mockedStat = stat as jest.MockedFunction<typeof stat>;

function makeFileStat(isDir = false) {
  return {
    isDirectory: () => isDir,
    isFile: () => !isDir,
  } as any;
}

describe('globFilesTool', () => {
  afterEach(() => jest.clearAllMocks());

  describe('happy path', () => {
    it('returns files matching extension filter', async () => {
      mockedReaddir.mockResolvedValue(['foo.ts', 'bar.js', 'readme.md'] as any);
      mockedStat.mockImplementation(async (p: any) => makeFileStat(false));

      const result = await globFilesTool.invoke({
        root: '/tmp',
        extensions: ['.ts'],
      });

      expect(result).toContain('foo.ts');
      expect(result).not.toContain('bar.js');
      expect(result).not.toContain('readme.md');
    });

    it('returns all files when no extension filter is provided', async () => {
      mockedReaddir.mockResolvedValue(['foo.ts', 'bar.js'] as any);
      mockedStat.mockResolvedValue(makeFileStat(false));

      const result = await globFilesTool.invoke({ root: '/tmp' });

      expect(result).toContain('foo.ts');
      expect(result).toContain('bar.js');
    });

    it('recursively walks into subdirectories', async () => {
      // First call: root /tmp has a subdir and a file
      mockedReaddir
        .mockResolvedValueOnce(['subdir', 'root.ts'] as any)
        // Second call: subdir has one file
        .mockResolvedValueOnce(['nested.ts'] as any);

      mockedStat.mockImplementation(async (p: any) => {
        if (String(p).endsWith('subdir')) return makeFileStat(true);
        return makeFileStat(false);
      });

      const result = await globFilesTool.invoke({ root: '/tmp' });

      expect(result).toContain('root.ts');
      expect(result).toContain('nested.ts');
    });

    it('skips node_modules and other excluded directories', async () => {
      mockedReaddir.mockResolvedValue([
        'node_modules',
        '.git',
        'dist',
        'coverage',
        'src.ts',
      ] as any);
      mockedStat.mockImplementation(async (p: any) => {
        const name = String(p).split('/').pop()!;
        const excluded = ['node_modules', '.git', 'dist', 'coverage'];
        return makeFileStat(excluded.includes(name));
      });

      const result = await globFilesTool.invoke({ root: '/tmp' });

      // Only src.ts should appear; excluded dirs should never be entered
      expect(result).toContain('src.ts');
      // readdir should only be called once (for root, not for the excluded dirs)
      expect(mockedReaddir).toHaveBeenCalledTimes(1);
    });

    it('respects maxResults limit', async () => {
      // 10 files available
      mockedReaddir.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => `file${i}.ts`) as any,
      );
      mockedStat.mockResolvedValue(makeFileStat(false));

      const result = await globFilesTool.invoke({
        root: '/tmp',
        maxResults: 3,
      });

      const lines = result.trim().split('\n');
      expect(lines).toHaveLength(3);
    });
  });

  describe('empty directory', () => {
    it('returns "No files found." message', async () => {
      mockedReaddir.mockResolvedValue([] as any);

      const result = await globFilesTool.invoke({ root: '/tmp' });

      expect(result).toBe('No files found.');
    });

    it('returns no-files message when extension filter matches nothing', async () => {
      mockedReaddir.mockResolvedValue(['readme.md'] as any);
      mockedStat.mockResolvedValue(makeFileStat(false));

      const result = await globFilesTool.invoke({
        root: '/tmp',
        extensions: ['.ts'],
      });

      expect(result).toBe('No files found.');
    });
  });

  describe('sandbox enforcement', () => {
    it('throws (or returns error) when root is outside agentWorkingDir', async () => {
      // sandboxPath will throw for /etc — the tool should propagate the error
      await expect(
        globFilesTool.invoke({ root: '/etc/passwd' }),
      ).rejects.toThrow(/Access denied/);
    });
  });
});
