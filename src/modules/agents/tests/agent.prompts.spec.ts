jest.mock('@config/env', () => ({
  env: {
    promptMaxAttempts: 5,
    promptMaxSummaryChars: 2000,
    agentWorkingDir: '/tmp',
  },
}));
jest.mock('../tools', () => ({
  toolRegistry: {
    getToolsWithParams: jest
      .fn()
      .mockReturnValue(
        '- search: {"query":"<q>"}\n- read_file: {"path":"<p>"}\n- write_file: {"path":"<p>","content":"<c>"}',
      ),
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
