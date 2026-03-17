import { Logger } from '@nestjs/common';
import { VectorModule } from './vector.module';

const mockQdrantClient = {
  getCollections: jest.fn(),
  getCollection: jest.fn(),
  createCollection: jest.fn(),
};

jest.mock('@config/env', () => ({
  env: {
    qdrantUrl: 'http://localhost:6333',
    qdrantCheckCompatibility: false,
    qdrantCollection: 'agent_vectors',
    qdrantVectorSize: 384,
  },
}));

describe('VectorModule', () => {
  beforeEach(() => {
    mockQdrantClient.getCollections.mockReset();
    mockQdrantClient.getCollection.mockReset();
    mockQdrantClient.createCollection.mockReset();
    jest.restoreAllMocks();
  });

  it('connects Qdrant during module init using the injected client', async () => {
    mockQdrantClient.getCollections.mockResolvedValue({
      collections: [{ name: 'agent_vectors' }],
    });
    mockQdrantClient.getCollection.mockResolvedValue({
      config: { params: { vectors: { size: 384 } } },
    });

    await expect(
      new VectorModule(mockQdrantClient as any).onModuleInit(),
    ).resolves.toBeUndefined();

    expect(mockQdrantClient.getCollections).toHaveBeenCalledTimes(1);
    expect(mockQdrantClient.getCollection).toHaveBeenCalledWith(
      'agent_vectors',
    );
  });

  it('logs Qdrant startup failures without crashing init', async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    mockQdrantClient.getCollections.mockRejectedValue(new Error('fetch failed'));

    await expect(
      new VectorModule(mockQdrantClient as any).onModuleInit(),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Qdrant connection failed: fetch failed'),
    );
  });
});
