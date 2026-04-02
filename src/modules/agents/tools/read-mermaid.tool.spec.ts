const mockReadFile = jest.fn();

jest.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: (p: string) => `/workspace/${p}`,
}));

import { readMermaidTool } from './read-mermaid.tool';

describe('readMermaidTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('truncates files larger than MAX_SIZE with a notice', async () => {
    const large = 'flowchart LR\n' + 'A --> B\n'.repeat(20_000); // > 100 KB
    mockReadFile.mockResolvedValue(large);

    const result = await readMermaidTool.invoke({ path: 'big.mmd' });

    expect(result.length).toBeLessThanOrEqual(100_010); // MAX_SIZE + notice overhead
    expect(result).toContain('[truncated]');
  });

  it('returns full content for files within size limit', async () => {
    const small = 'flowchart LR\nA --> B';
    mockReadFile.mockResolvedValue(small);

    const result = await readMermaidTool.invoke({ path: 'small.mmd' });
    expect(result).toBe(small);
  });
});
