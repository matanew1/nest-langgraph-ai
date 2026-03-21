import {
  formatAttempts,
  getAvailableTools,
  formatPromptSection,
} from './prompt-context.util';
import { AgentState } from '../state/agent.state';
import { ToolResult } from '../tools/tool-result';

jest.mock('@config/env', () => ({
  env: {
    promptMaxAttempts: 5,
    promptMaxSummaryChars: 2000,
    criticResultMaxChars: 8000,
  },
}));

// Mock toolRegistry so getAvailableTools doesn't import real tools
jest.mock('../tools/index', () => ({
  toolRegistry: {
    describeForPrompt: jest.fn((opts?: { excludeNames?: Set<string> }) => {
      const allTools = [
        '- read_file: Read a file from disk',
        '- search: Search the web',
        '- write_file: Write to a file',
      ];
      const excluded = opts?.excludeNames ?? new Set();
      return allTools
        .filter((line) => {
          const name = line.split(':')[0].replace('- ', '').trim();
          return !excluded.has(name);
        })
        .join('\n');
    }),
  },
}));

function makeToolResult(ok: boolean, preview = 'result'): ToolResult {
  return {
    ok,
    kind: 'text',
    summary: ok ? 'Tool returned text.' : 'Tool returned an error.',
    preview,
    raw: preview,
  };
}

function makeAttempt(
  tool: string,
  step: number,
  ok = true,
  preview = 'result',
) {
  return {
    tool,
    step,
    params: { key: 'value' },
    result: makeToolResult(ok, preview),
  };
}

const emptyState: Partial<AgentState> = {
  attempts: [],
  input: 'test',
  plan: [],
  errors: [],
  currentStep: 0,
  counters: {
    turn: 0,
    toolCalls: 0,
    replans: 0,
    stepRetries: 0,
    supervisorFallbacks: 0,
  },
};

describe('formatAttempts', () => {
  it('returns empty string when attempts is empty', () => {
    const result = formatAttempts(emptyState as AgentState);
    expect(result).toBe('');
  });

  it('returns empty string when attempts is undefined', () => {
    const state = {
      ...emptyState,
      attempts: undefined,
    } as unknown as AgentState;
    const result = formatAttempts(state);
    expect(result).toBe('');
  });

  it('formats a single attempt with tool name and result summary', () => {
    const state: Partial<AgentState> = {
      ...emptyState,
      attempts: [makeAttempt('read_file', 0, true, 'file contents here')],
    };

    const result = formatAttempts(state as AgentState);

    expect(result).toContain('read_file');
    expect(result).toContain('Previous attempts');
    expect(result).toContain('OK');
  });

  it('formats a failed attempt with ERROR marker', () => {
    const state: Partial<AgentState> = {
      ...emptyState,
      attempts: [makeAttempt('search', 1, false, 'ERROR: not found')],
    };

    const result = formatAttempts(state as AgentState);

    expect(result).toContain('ERROR');
    expect(result).toContain('search');
  });

  it('only shows up to promptMaxAttempts recent attempts', () => {
    // More than 5 attempts
    const attempts = Array.from({ length: 8 }, (_, i) =>
      makeAttempt(`tool_${i}`, i),
    );
    const state: Partial<AgentState> = {
      ...emptyState,
      attempts,
    };

    const result = formatAttempts(state as AgentState);

    // Should only show last 5 attempts (tool_3 through tool_7)
    expect(result).toContain('tool_7');
    expect(result).toContain('tool_3');
    // tool_0 and tool_1 and tool_2 should be excluded
    expect(result).not.toContain('tool_0');
    expect(result).not.toContain('tool_1');
    expect(result).not.toContain('tool_2');
  });

  it('includes step number in output', () => {
    const state: Partial<AgentState> = {
      ...emptyState,
      attempts: [makeAttempt('write_file', 3)],
    };

    const result = formatAttempts(state as AgentState);

    // step displayed as step+1
    expect(result).toContain('step=4');
  });
});

describe('getAvailableTools', () => {
  it('returns a formatted list of all tools in registry', () => {
    const result = getAvailableTools(emptyState as AgentState);

    expect(result).toContain('read_file');
    expect(result).toContain('search');
    expect(result).toContain('write_file');
  });

  it('excludes tools that have failed attempts', () => {
    const state: Partial<AgentState> = {
      ...emptyState,
      attempts: [makeAttempt('search', 0, false, 'ERROR: no results')],
    };

    const result = getAvailableTools(state as AgentState);

    // 'search' had a failed attempt, so it should be excluded
    expect(result).not.toContain('- search:');
    expect(result).toContain('read_file');
  });

  it('does not exclude tools that had successful attempts', () => {
    const state: Partial<AgentState> = {
      ...emptyState,
      attempts: [makeAttempt('read_file', 0, true)],
    };

    const result = getAvailableTools(state as AgentState);

    // read_file succeeded, so it should NOT be excluded
    expect(result).toContain('read_file');
  });

  it('excludes multiple tools that all failed', () => {
    const state: Partial<AgentState> = {
      ...emptyState,
      attempts: [
        makeAttempt('search', 0, false, 'ERROR'),
        makeAttempt('write_file', 1, false, 'ERROR'),
      ],
    };

    const result = getAvailableTools(state as AgentState);

    expect(result).not.toContain('- search:');
    expect(result).not.toContain('- write_file:');
    expect(result).toContain('read_file');
  });
});

describe('formatPromptSection', () => {
  it('returns fallback when value is undefined', () => {
    const result = formatPromptSection(undefined, '(none available)');
    expect(result).toBe('(none available)');
  });

  it('returns fallback when value is empty string', () => {
    const result = formatPromptSection('', '(none)');
    expect(result).toBe('(none)');
  });

  it('returns fallback when value is only whitespace', () => {
    const result = formatPromptSection('   ', '(none)');
    expect(result).toBe('(none)');
  });

  it('returns the trimmed value when within maxChars', () => {
    const result = formatPromptSection('  hello world  ', '(none)', 100);
    expect(result).toBe('hello world');
  });

  it('truncates value that exceeds maxChars', () => {
    const long = 'A'.repeat(200);
    const result = formatPromptSection(long, '(none)', 100);
    expect(result).toContain('[truncated]');
    expect(result.startsWith('A'.repeat(100))).toBe(true);
  });
});
