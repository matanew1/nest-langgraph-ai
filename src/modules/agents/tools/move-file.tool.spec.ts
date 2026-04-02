const mockMkdir = jest.fn().mockResolvedValue(undefined);
const mockRename = jest.fn().mockResolvedValue(undefined);
const mockStat = jest.fn();

jest.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  rename: (...args: unknown[]) => mockRename(...args),
  stat: (...args: unknown[]) => mockStat(...args),
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: (p: string) => `/workspace/${p}`,
}));

import { moveFileTool } from './move-file.tool';

describe('moveFileTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns a warning when the destination already exists', async () => {
    mockStat.mockResolvedValue({ isFile: () => true }); // destination exists

    const result = await moveFileTool.invoke({ from: 'src.ts', to: 'dest.ts' });

    expect(result).toMatch(/already exists/i);
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('proceeds with rename when destination does not exist', async () => {
    mockStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const result = await moveFileTool.invoke({ from: 'src.ts', to: 'dest.ts' });

    expect(mockRename).toHaveBeenCalled();
    expect(result).toContain('Moved');
  });
});
