const mockQdrantClient = jest.fn();

jest.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: mockQdrantClient,
}));

jest.mock('@config/env', () => ({
  env: {
    qdrantUrl: 'http://localhost:6333',
    qdrantCheckCompatibility: false,
    qdrantCollection: 'agent_vectors',
    qdrantVectorSize: 384,
  },
}));

import { qdrantClient } from './qdrant.provider';

describe('qdrant.provider', () => {
  it('constructs the client with the configured compatibility flag', () => {
    expect(qdrantClient).toBeDefined();
    expect(mockQdrantClient).toHaveBeenCalledWith({
      url: 'http://localhost:6333',
      checkCompatibility: false,
    });
  });
});
