const mockUpsert = jest.fn();

jest.mock('@vector-db/vector-memory.util', () => ({
  upsertVectorMemory: (...args: unknown[]) => mockUpsert(...args),
}));

import { vectorUpsertTool } from './vector-upsert.tool';

describe('vectorUpsertTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns an error string when upsertVectorMemory throws', async () => {
    mockUpsert.mockRejectedValueOnce(new Error('Qdrant unreachable'));
    const result = await vectorUpsertTool.invoke({ text: 'hello', id: '1' });
    expect(result).toMatch(/ERROR.*Qdrant unreachable/i);
  });

  it('returns an error when the result contains an error field', async () => {
    mockUpsert.mockResolvedValueOnce({ error: 'payload schema mismatch' });
    const result = await vectorUpsertTool.invoke({ text: 'hello', id: '1' });
    expect(result).toMatch(/ERROR.*payload schema mismatch/i);
  });

  it('returns ok:true JSON on success', async () => {
    mockUpsert.mockResolvedValueOnce({ id: '1', updated: true });
    const result = await vectorUpsertTool.invoke({ text: 'hello', id: '1' });
    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
  });
});
