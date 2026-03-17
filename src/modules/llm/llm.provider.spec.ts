jest.mock('@config/env', () => ({
  env: {
    mistralKey: 'key',
    mistralModel: 'mistral-small-latest',
    mistralTimeoutMs: 5000,
  },
}));

const mockInvoke = jest.fn();
jest.mock('@langchain/mistralai', () => ({
  ChatMistralAI: jest.fn().mockImplementation(() => ({ invoke: mockInvoke })),
}));

import { invokeLlm } from './llm.provider';

describe('invokeLlm', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns string content directly', async () => {
    mockInvoke.mockResolvedValue({ content: 'hello world' });
    const result = await invokeLlm('prompt');
    expect(result).toBe('hello world');
  });

  it('joins array content into a single string', async () => {
    mockInvoke.mockResolvedValue({
      content: [
        { type: 'text', text: 'hello' },
        { type: 'text', text: ' world' },
      ],
    });
    const result = await invokeLlm('prompt');
    expect(result).toBe('hello world');
  });

  it('falls back to String() for unexpected content types', async () => {
    mockInvoke.mockResolvedValue({ content: 42 });
    const result = await invokeLlm('prompt');
    expect(result).toBe('42');
  });
});
