import { streamLlm, resetCircuitBreaker } from '@llm/llm.provider';

jest.mock('@config/env', () => ({
  env: {
    mistralKey: 'test-key',
    mistralModel: 'mistral-small-latest',
    mistralTimeoutMs: 5000,
    agentMaxRetries: 2,
  },
}));

jest.mock('@langchain/mistralai', () => ({
  ChatMistralAI: jest.fn().mockImplementation(() => ({
    invoke: jest.fn(),
    stream: jest.fn(),
  })),
}));

jest.mock('@utils/pretty-log.util', () => ({
  logPhaseStart: jest.fn(),
  logPhaseEnd: jest.fn(),
  startTimer: jest.fn(() => () => 0),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { llm } = require('@llm/llm.provider') as { llm: { stream: jest.Mock } };

describe('streamLlm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetCircuitBreaker();
  });

  it('yields individual chunks from the LLM stream', async () => {
    const chunks = [
      { content: 'Hello' },
      { content: ' world' },
      { content: '!' },
    ];
    llm.stream.mockResolvedValue((async function* () {
      for (const chunk of chunks) yield chunk;
    })());

    const tokens: string[] = [];
    const generator = streamLlm('test prompt');
    for await (const token of generator) {
      tokens.push(token);
    }

    expect(tokens).toEqual(['Hello', ' world', '!']);
  });

  it('returns full concatenated string from generator.return()', async () => {
    const chunks = [{ content: 'ab' }, { content: 'cd' }];
    llm.stream.mockResolvedValue((async function* () {
      for (const chunk of chunks) yield chunk;
    })());

    let fullText = '';
    const generator = streamLlm('test prompt');
    for await (const token of generator) {
      fullText += token;
    }

    expect(fullText).toBe('abcd');
  });
});
