const mockReadFile = jest.fn();
const mockWriteFile = jest.fn().mockResolvedValue(undefined);

jest.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: (p: string) => `/workspace/${p}`,
}));

import { filePatchTool } from './file-patch.tool';

describe('filePatchTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns an error when the pattern appears more than MAX_OCCURRENCES times', async () => {
    // Build a string with 1001 occurrences of "x"
    const content = 'x\n'.repeat(1001);
    mockReadFile.mockResolvedValue(content);

    const result = await filePatchTool.invoke({
      path: 'large.ts',
      find: 'x',
      replace: 'y',
    });

    expect(result).toMatch(/too many occurrences|too common/i);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
