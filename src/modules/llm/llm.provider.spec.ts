jest.mock('@config/env', () => ({
  env: {
    mistralKey: 'key',
    mistralModelFast: 'mistral-small-latest',
    mistralModelBalanced: 'mistral-small-latest',
    mistralModelPowerful: 'mistral-large-latest',
    mistralModelCode: 'codestral-latest',
    mistralModelVision: 'pixtral-large-latest',
    mistralTimeoutMs: 5000,
    agentMaxRetries: 0,
  },
}));

const mockInvoke = jest.fn();
const mockChatMistralAI = jest
  .fn()
  .mockImplementation(() => ({ invoke: mockInvoke }));
jest.mock('@langchain/mistralai', () => ({
  ChatMistralAI: mockChatMistralAI,
}));

import { invokeLlm, invokeLlmWithImages } from './llm.provider';

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

  it('uses the vision model for image inputs even when passed a text-tier default model', async () => {
    mockChatMistralAI.mockClear();
    mockInvoke.mockResolvedValue({ content: 'vision answer' });

    const result = await invokeLlmWithImages(
      'prompt',
      [{ url: 'https://example.com/image.png' }],
      undefined,
      undefined,
      undefined,
      'mistral-small-latest',
    );

    expect(result).toBe('vision answer');
    expect(mockChatMistralAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'key',
        model: 'pixtral-large-latest',
        temperature: 0,
      }),
    );
  });
});
