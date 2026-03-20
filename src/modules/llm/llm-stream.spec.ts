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

  it('throws immediately when circuit breaker is open', async () => {
    // Trip the circuit breaker by exhausting failures
    llm.stream.mockRejectedValue(new Error('server error'));
    for (let i = 0; i < 5; i++) {
      try {
        for await (const _ of streamLlm('p', 100, 0)) { /* drain */ }
      } catch { /* expected */ }
    }
    llm.stream.mockClear();

    // Circuit is now open — next call should throw without calling llm.stream
    await expect(async () => {
      for await (const _ of streamLlm('p', 100, 0)) { /* drain */ }
    }).rejects.toThrow(/circuit breaker open/);
    expect(llm.stream).not.toHaveBeenCalled();
  });

  it('does not retry on 401 authentication error', async () => {
    llm.stream.mockRejectedValue(new Error('401 Unauthorized'));

    await expect(async () => {
      for await (const _ of streamLlm('p', 100, 2)) { /* drain */ }
    }).rejects.toThrow('401 Unauthorized');

    expect(llm.stream).toHaveBeenCalledTimes(1);
  });

  it('retries on transient error and succeeds on second attempt', async () => {
    const chunks = [{ content: 'ok' }];
    llm.stream
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce((async function* () {
        for (const c of chunks) yield c;
      })());

    const tokens: string[] = [];
    for await (const token of streamLlm('p', 100, 1)) {
      tokens.push(token);
    }

    expect(tokens).toEqual(['ok']);
    expect(llm.stream).toHaveBeenCalledTimes(2);
  });
});
