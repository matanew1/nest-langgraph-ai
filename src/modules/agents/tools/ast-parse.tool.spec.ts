const mockStatSync = jest.fn();
const mockReadFileSync = jest.fn();

jest.mock('node:fs', () => ({
  statSync: (...args: unknown[]) => mockStatSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: (p: string) => `/workspace/${p}`,
}));

import { astParseTool } from './ast-parse.tool';

describe('astParseTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns an error for files exceeding MAX_FILE_BYTES', async () => {
    mockStatSync.mockReturnValue({ size: 600_000 });
    const result = await astParseTool.invoke({ path: 'huge.ts' });
    expect(result).toMatch(/ERROR.*too large/i);
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });
});
