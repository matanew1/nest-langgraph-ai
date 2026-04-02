const mockSearch = jest.fn();

jest.mock('@vector-db/vector-memory.util', () => ({
  searchVectorMemories: (...args: unknown[]) => mockSearch(...args),
}));

import { vectorSearchTool } from './vector-search.tool';

describe('vectorSearchTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns an error string when searchVectorMemories throws', async () => {
    mockSearch.mockRejectedValueOnce(new Error('Qdrant timeout'));
    const result = await vectorSearchTool.invoke({ query: 'auth middleware' });
    expect(result).toMatch(/ERROR.*Qdrant timeout/i);
  });

  it('returns ok:true JSON with results on success', async () => {
    mockSearch.mockResolvedValueOnce([{ id: '1', score: 0.9 }]);
    const result = await vectorSearchTool.invoke({ query: 'auth', topK: 1 });
    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.results).toHaveLength(1);
  });
});
