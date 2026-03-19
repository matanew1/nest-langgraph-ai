import { toolResultNormalizerNode } from '../nodes/tool-result-normalizer.node';
import { AgentState } from '../state/agent.state';

jest.mock('@config/env', () => ({
  env: {
    criticResultMaxChars: 8000,
  },
}));

jest.mock('@utils/pretty-log.util', () => ({
  logPhaseStart: jest.fn(),
  logPhaseEnd: jest.fn(),
  startTimer: jest.fn(() => () => 0),
}));

const baseState: Partial<AgentState> = {
  input: 'do something',
  selectedTool: 'read_file',
  toolResultRaw: '',
  currentStep: 0,
  toolParams: { path: 'src/main.ts' },
  attempts: [],
  plan: [],
  errors: [],
  counters: {
    turn: 0,
    toolCalls: 0,
    replans: 0,
    stepRetries: 0,
    supervisorFallbacks: 0,
  },
};

describe('toolResultNormalizerNode', () => {
  afterEach(() => jest.clearAllMocks());

  it('transitions to phase=judge', async () => {
    const state: Partial<AgentState> = {
      ...baseState,
      toolResultRaw: 'Plain text result from tool',
    };

    const result = await toolResultNormalizerNode(state as AgentState);

    expect(result.phase).toBe('judge');
  });

  it('normalizes plain text raw output to kind=text with ok=true', async () => {
    const state: Partial<AgentState> = {
      ...baseState,
      toolResultRaw: 'This is the file contents',
    };

    const result = await toolResultNormalizerNode(state as AgentState);

    expect(result.toolResult).toBeDefined();
    expect(result.toolResult!.kind).toBe('text');
    expect(result.toolResult!.ok).toBe(true);
  });

  it('normalizes JSON raw output to kind=json', async () => {
    const state: Partial<AgentState> = {
      ...baseState,
      toolResultRaw: '{"status": "ok", "count": 42}',
    };

    const result = await toolResultNormalizerNode(state as AgentState);

    expect(result.toolResult).toBeDefined();
    expect(result.toolResult!.kind).toBe('json');
    expect(result.toolResult!.ok).toBe(true);
    expect(result.toolResult!.json).toEqual({ status: 'ok', count: 42 });
  });

  it('normalizes ERROR-prefixed raw output to ok=false', async () => {
    const state: Partial<AgentState> = {
      ...baseState,
      toolResultRaw: 'ERROR: file not found at path src/missing.ts',
    };

    const result = await toolResultNormalizerNode(state as AgentState);

    expect(result.toolResult).toBeDefined();
    expect(result.toolResult!.ok).toBe(false);
  });

  it('normalizes empty raw output to kind=empty with ok=false', async () => {
    const state: Partial<AgentState> = {
      ...baseState,
      toolResultRaw: '',
    };

    const result = await toolResultNormalizerNode(state as AgentState);

    expect(result.toolResult).toBeDefined();
    expect(result.toolResult!.kind).toBe('empty');
    expect(result.toolResult!.ok).toBe(false);
  });

  it('handles undefined toolResultRaw gracefully (treated as empty)', async () => {
    const state: Partial<AgentState> = {
      ...baseState,
      toolResultRaw: undefined,
    };

    const result = await toolResultNormalizerNode(state as AgentState);

    expect(result.toolResult).toBeDefined();
    expect(result.toolResult!.ok).toBe(false);
    expect(result.toolResult!.kind).toBe('empty');
  });

  it('truncates preview for large output and keeps full raw', async () => {
    const largeOutput = 'A'.repeat(20_000);
    const state: Partial<AgentState> = {
      ...baseState,
      toolResultRaw: largeOutput,
    };

    const result = await toolResultNormalizerNode(state as AgentState);

    expect(result.toolResult).toBeDefined();
    expect(result.toolResult!.ok).toBe(true);
    // preview should be truncated to criticResultMaxChars (8000)
    expect(result.toolResult!.preview.length).toBeLessThanOrEqual(
      8000 + 50, // some buffer for the truncation suffix
    );
    // raw is kept up to rawMaxChars (200k), large output fits
    expect(result.toolResult!.raw).toBe(largeOutput);
  });

  it('appends an attempt when selectedTool is set', async () => {
    const state: Partial<AgentState> = {
      ...baseState,
      selectedTool: 'read_file',
      toolResultRaw: 'file contents here',
      currentStep: 2,
      toolParams: { path: 'src/app.ts' },
    };

    const result = await toolResultNormalizerNode(state as AgentState);

    expect(result.attempts).toBeDefined();
    expect(result.attempts!.length).toBe(1);
    expect(result.attempts![0].tool).toBe('read_file');
    expect(result.attempts![0].step).toBe(2);
    expect(result.attempts![0].params).toEqual({ path: 'src/app.ts' });
    expect(result.attempts![0].result).toBeDefined();
  });

  it('does not append an attempt when selectedTool is undefined', async () => {
    const state: Partial<AgentState> = {
      ...baseState,
      selectedTool: undefined,
      toolResultRaw: 'some output',
    };

    const result = await toolResultNormalizerNode(state as AgentState);

    expect(result.attempts).toEqual([]);
  });

  it('sets meta.tool from selectedTool (falling back to unknown)', async () => {
    const state: Partial<AgentState> = {
      ...baseState,
      selectedTool: 'git_info',
      toolResultRaw: 'On branch main',
    };

    const result = await toolResultNormalizerNode(state as AgentState);

    expect(result.toolResult!.meta!.tool).toBe('git_info');
  });

  it('uses "unknown" as tool name when selectedTool is undefined', async () => {
    const state: Partial<AgentState> = {
      ...baseState,
      selectedTool: undefined,
      toolResultRaw: 'Some result',
    };

    const result = await toolResultNormalizerNode(state as AgentState);

    expect(result.toolResult!.meta!.tool).toBe('unknown');
  });
});
