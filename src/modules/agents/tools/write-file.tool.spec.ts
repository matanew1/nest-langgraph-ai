const mockMkdir = jest.fn().mockResolvedValue(undefined);
const mockWriteFile = jest.fn().mockResolvedValue(undefined);

jest.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: (p: string) => `/workspace/${p}`,
}));

import { writeFileTool } from './write-file.tool';

describe('writeFileTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('extracts code from a fenced block that has no newline after lang tag', async () => {
    // Old regex required \n after lang tag; new regex makes \n optional (space works too)
    const content = '```ts const x = 1;```';
    await writeFileTool.invoke({ path: 'out.ts', content });
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/workspace/out.ts',
      'const x = 1;',
      'utf-8',
    );
  });

  it('returns an error string when writeFile throws (no unhandled rejection)', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('EACCES: permission denied'));
    const result = await writeFileTool.invoke({ path: 'readonly.ts', content: 'x' });
    expect(result).toMatch(/ERROR/);
    expect(result).toMatch(/EACCES/);
  });

  it('returns an error string when mkdir throws', async () => {
    mockMkdir.mockRejectedValueOnce(new Error('EPERM: not permitted'));
    const result = await writeFileTool.invoke({ path: 'bad/path.ts', content: 'x' });
    expect(result).toMatch(/ERROR/);
  });
});
