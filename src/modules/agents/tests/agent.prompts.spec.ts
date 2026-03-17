jest.mock('@config/env', () => ({
  env: {
    promptMaxAttempts: 5,
    promptMaxSummaryChars: 2000,
    agentWorkingDir: '/tmp',
  },
}));
jest.mock('../tools', () => ({
  toolRegistry: {
    describeForPrompt: jest.fn(({ excludeNames }: { excludeNames?: Iterable<string> }) => {
      const excluded = new Set(excludeNames ?? []);
      return [
        ['search', '- search: search tool\n  params: {"query":"<q>"}'],
        ['read_file', '- read_file: read file\n  params: {"path":"<p>"}'],
        [
          'write_file',
          '- write_file: write file\n  params: {"path":"<p>","content":"<c>"}',
        ],
      ]
        .filter(([name]) => !excluded.has(name))
        .map(([, line]) => line)
        .join('\n');
    }),
  },
}));

import { buildSupervisorPrompt } from '../prompts/agent.prompts';
import { AgentState } from '../state/agent.state';

const makeAttempt = (tool: string, ok: boolean) => ({
  tool,
  step: 0,
  params: {},
  result: {
    ok,
    kind: ok ? ('text' as const) : ('error' as const),
    summary: '',
    preview: '',
    raw: '',
  },
});

describe('getAvailableTools (via buildSupervisorPrompt)', () => {
  it('excludes ALL tools that had failed attempts', () => {
    const state = {
      input: 'test',
      attempts: [makeAttempt('search', false), makeAttempt('read_file', false)],
    } as unknown as AgentState;

    const prompt = buildSupervisorPrompt(state);

    expect(prompt).not.toContain('- search:');
    expect(prompt).not.toContain('- read_file:');
    expect(prompt).toContain('- write_file:');
  });

  it('keeps all tools when no attempts failed', () => {
    const state = {
      input: 'test',
      attempts: [makeAttempt('search', true)],
    } as unknown as AgentState;

    const prompt = buildSupervisorPrompt(state);
    expect(prompt).toContain('- search:');
  });
});
