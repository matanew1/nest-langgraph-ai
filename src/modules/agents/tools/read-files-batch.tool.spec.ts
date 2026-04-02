const mockReadFile = jest.fn();

jest.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: (p: string) => `/workspace/${p}`,
}));

import { readFilesBatchTool } from './read-files-batch.tool';

describe('readFilesBatchTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deduplicates paths so identical paths are read only once', async () => {
    // 5 total paths, 4 unique (file0.ts appears twice)
    const paths = ['file0.ts', 'file1.ts', 'file2.ts', 'file3.ts', 'file0.ts'];
    mockReadFile.mockResolvedValue('content');

    await readFilesBatchTool.invoke({ paths });

    // 4 unique paths → 4 readFile calls, not 5
    expect(mockReadFile).toHaveBeenCalledTimes(4);
  });

  it('includes an error note for files that cannot be read', async () => {
    mockReadFile.mockImplementation((p: string) => {
      if (p.includes('missing')) return Promise.reject(new Error('ENOENT'));
      return Promise.resolve('hello');
    });

    const result = await readFilesBatchTool.invoke({
      paths: ['good.ts', 'missing.ts'],
    });

    expect(result).toContain('=== good.ts ===');
    expect(result).toContain('=== missing.ts ===');
    expect(result).toMatch(/ERROR.*ENOENT/i);
  });
});
