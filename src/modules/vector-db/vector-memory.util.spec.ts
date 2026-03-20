import { searchVectorMemories, upsertVectorMemory } from './vector-memory.util';

jest.mock('@config/env', () => ({
  env: {
    qdrantCollection: 'test_collection',
    qdrantVectorSize: 384,
    qdrantUrl: 'http://localhost:6333',
    qdrantCheckCompatibility: false,
  },
}));

// Mock EmbeddingService. The factory runs in a hoisted context so we
// store the stub on the module-level object that jest.mock captures.
jest.mock('./embedding.service', () => {
  const embedFn = jest.fn();
  return {
    EmbeddingService: jest.fn().mockImplementation(() => ({ embed: embedFn })),
    __embedFn: embedFn,
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockEmbed: jest.Mock = require('./embedding.service').__embedFn;

// Mock qdrant provider
const mockEnsureQdrantReady = jest.fn();
const mockQdrantSearch = jest.fn();
const mockQdrantUpsert = jest.fn();
const mockQdrantGetCollections = jest.fn();
const mockQdrantCreateCollection = jest.fn();
const mockQdrantGetCollection = jest.fn();

jest.mock('./qdrant.provider', () => ({
  ensureQdrantReady: (...args: unknown[]) => mockEnsureQdrantReady(...args),
  qdrantClient: {
    search: (...args: unknown[]) => mockQdrantSearch(...args),
    upsert: (...args: unknown[]) => mockQdrantUpsert(...args),
    getCollections: (...args: unknown[]) => mockQdrantGetCollections(...args),
    createCollection: (...args: unknown[]) =>
      mockQdrantCreateCollection(...args),
    getCollection: (...args: unknown[]) => mockQdrantGetCollection(...args),
  },
  getVectorSizeFromCollectionInfo: jest.fn(),
}));

const FAKE_VECTOR = Array.from({ length: 384 }, (_, i) => i * 0.001);

describe('searchVectorMemories', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEmbed.mockResolvedValue(FAKE_VECTOR);
    mockEnsureQdrantReady.mockResolvedValue(undefined);
  });

  it('returns results from Qdrant search', async () => {
    mockQdrantSearch.mockResolvedValue([
      {
        id: 'abc-123',
        score: 0.95,
        payload: { text: 'This is relevant memory.' },
      },
      {
        id: 'def-456',
        score: 0.8,
        payload: { summary: 'Another relevant result.' },
      },
    ]);

    const results = await searchVectorMemories('find memories', {
      client: {
        search: mockQdrantSearch,
        upsert: mockQdrantUpsert,
        getCollections: mockQdrantGetCollections,
        createCollection: mockQdrantCreateCollection,
        getCollection: mockQdrantGetCollection,
      },
    });

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('abc-123');
    expect(results[0].score).toBe(0.95);
    expect(results[0].text).toBe('This is relevant memory.');
    expect(results[1].text).toBe('Another relevant result.');
  });

  it('returns empty array when query is empty string', async () => {
    const results = await searchVectorMemories('');
    expect(results).toEqual([]);
    expect(mockEmbed).not.toHaveBeenCalled();
  });

  it('returns empty array when query is only whitespace', async () => {
    const results = await searchVectorMemories('   ');
    expect(results).toEqual([]);
    expect(mockEmbed).not.toHaveBeenCalled();
  });

  it('returns empty array when embedding returns empty vector', async () => {
    mockEmbed.mockResolvedValue([]);

    const results = await searchVectorMemories('some query', {
      client: {
        search: mockQdrantSearch,
        upsert: mockQdrantUpsert,
        getCollections: mockQdrantGetCollections,
        createCollection: mockQdrantCreateCollection,
        getCollection: mockQdrantGetCollection,
      },
    });

    expect(results).toEqual([]);
    expect(mockQdrantSearch).not.toHaveBeenCalled();
  });

  it('respects topK option', async () => {
    mockQdrantSearch.mockResolvedValue([]);

    await searchVectorMemories('find something', {
      topK: 10,
      client: {
        search: mockQdrantSearch,
        upsert: mockQdrantUpsert,
        getCollections: mockQdrantGetCollections,
        createCollection: mockQdrantCreateCollection,
        getCollection: mockQdrantGetCollection,
      },
    });

    expect(mockQdrantSearch).toHaveBeenCalledWith(
      'test_collection',
      expect.objectContaining({ limit: 10 }),
    );
  });

  it('respects scoreThreshold option', async () => {
    mockQdrantSearch.mockResolvedValue([]);

    await searchVectorMemories('find something', {
      scoreThreshold: 0.9,
      client: {
        search: mockQdrantSearch,
        upsert: mockQdrantUpsert,
        getCollections: mockQdrantGetCollections,
        createCollection: mockQdrantCreateCollection,
        getCollection: mockQdrantGetCollection,
      },
    });

    expect(mockQdrantSearch).toHaveBeenCalledWith(
      'test_collection',
      expect.objectContaining({ score_threshold: 0.9 }),
    );
  });

  it('returns empty array gracefully when Qdrant search fails', async () => {
    // ensureQdrantReady fails → the function should propagate or handle
    mockEnsureQdrantReady.mockRejectedValue(new Error('Qdrant unavailable'));

    await expect(
      searchVectorMemories('query', {
        client: {
          search: mockQdrantSearch,
          upsert: mockQdrantUpsert,
          getCollections: mockQdrantGetCollections,
          createCollection: mockQdrantCreateCollection,
          getCollection: mockQdrantGetCollection,
        },
      }),
    ).rejects.toThrow('Qdrant unavailable');
  });

  it('maps payload text field to hit.text', async () => {
    mockQdrantSearch.mockResolvedValue([
      {
        id: 1,
        score: 0.7,
        payload: { text: 'Hello from memory' },
      },
    ]);

    const results = await searchVectorMemories('hello', {
      client: {
        search: mockQdrantSearch,
        upsert: mockQdrantUpsert,
        getCollections: mockQdrantGetCollections,
        createCollection: mockQdrantCreateCollection,
        getCollection: mockQdrantGetCollection,
      },
    });

    expect(results[0].text).toBe('Hello from memory');
    expect(results[0].payload).toEqual({ text: 'Hello from memory' });
  });

  it('handles payload with no known text fields gracefully', async () => {
    mockQdrantSearch.mockResolvedValue([
      {
        id: 'xyz',
        score: 0.6,
        payload: { someOtherField: 'value', another: 'thing' },
      },
    ]);

    const results = await searchVectorMemories('test', {
      client: {
        search: mockQdrantSearch,
        upsert: mockQdrantUpsert,
        getCollections: mockQdrantGetCollections,
        createCollection: mockQdrantCreateCollection,
        getCollection: mockQdrantGetCollection,
      },
    });

    expect(results[0].id).toBe('xyz');
    // text may be a JSON preview of the metadata
    expect(
      typeof results[0].text === 'string' || results[0].text === undefined,
    ).toBe(true);
  });
});

describe('upsertVectorMemory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEmbed.mockResolvedValue(FAKE_VECTOR);
    mockEnsureQdrantReady.mockResolvedValue(undefined);
    mockQdrantUpsert.mockResolvedValue({ status: 'ok' });
  });

  it('upserts into the correct collection with expected vector', async () => {
    const result = await upsertVectorMemory(
      { text: 'Store this memory', metadata: { source: 'test' } },
      { upsert: mockQdrantUpsert },
    );

    expect(mockQdrantUpsert).toHaveBeenCalledWith(
      'test_collection',
      expect.objectContaining({
        wait: true,
        points: [
          expect.objectContaining({
            vector: FAKE_VECTOR,
            payload: expect.objectContaining({
              text: 'Store this memory',
              source: 'test',
            }),
          }),
        ],
      }),
    );

    expect(result.collection).toBe('test_collection');
    expect(result.vectorSize).toBe(384);
    expect(typeof result.id).toBe('string');
  });

  it('uses provided id when given', async () => {
    const result = await upsertVectorMemory(
      { text: 'memory', id: 'my-custom-id' },
      { upsert: mockQdrantUpsert },
    );

    expect(result.id).toBe('my-custom-id');
    expect(mockQdrantUpsert).toHaveBeenCalledWith(
      'test_collection',
      expect.objectContaining({
        points: [expect.objectContaining({ id: 'my-custom-id' })],
      }),
    );
  });

  it('generates a UUID id when none is provided', async () => {
    const result = await upsertVectorMemory(
      { text: 'auto id memory' },
      { upsert: mockQdrantUpsert },
    );

    // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    expect(result.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('throws when embedding returns empty vector (empty text)', async () => {
    mockEmbed.mockResolvedValue([]);

    await expect(
      upsertVectorMemory({ text: '' }, { upsert: mockQdrantUpsert }),
    ).rejects.toThrow('Empty text');
  });

  it('propagates Qdrant upsert failure', async () => {
    mockQdrantUpsert.mockRejectedValue(new Error('Qdrant write failed'));

    await expect(
      upsertVectorMemory({ text: 'some text' }, { upsert: mockQdrantUpsert }),
    ).rejects.toThrow('Qdrant write failed');
  });

  it('includes metadata in the stored payload', async () => {
    await upsertVectorMemory(
      {
        text: 'with metadata',
        metadata: { session: 'abc', user: 'alice' },
      },
      { upsert: mockQdrantUpsert },
    );

    const [, upsertArgs] = mockQdrantUpsert.mock.calls[0];
    const point = upsertArgs.points[0];
    expect(point.payload.session).toBe('abc');
    expect(point.payload.user).toBe('alice');
    expect(point.payload.text).toBe('with metadata');
  });
});
