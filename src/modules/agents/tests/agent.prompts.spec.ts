jest.mock('@config/env', () => ({
  env: {
    promptMaxAttempts: 5,
    promptMaxSummaryChars: 2000,
    agentWorkingDir: '/tmp',
    criticResultMaxChars: 500,
  },
}));
jest.mock('../tools', () => ({
  toolRegistry: {
    describeForPrompt: jest.fn(
      ({ excludeNames }: { excludeNames?: Iterable<string> }) => {
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
      },
    ),
  },
}));

import {
  buildSupervisorPrompt,
  buildPlannerPrompt,
  buildCriticPrompt,
} from '../prompts/agent.prompts';
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
  it('excludes tools that failed 2+ times with different params', () => {
    const state = {
      input: 'test',
      attempts: [
        { tool: 'search', step: 0, params: { query: 'a' }, result: { ok: false, kind: 'error', summary: '', preview: '', raw: '' } },
        { tool: 'search', step: 1, params: { query: 'b' }, result: { ok: false, kind: 'error', summary: '', preview: '', raw: '' } },
        { tool: 'read_file', step: 2, params: { path: 'x' }, result: { ok: false, kind: 'error', summary: '', preview: '', raw: '' } },
        { tool: 'read_file', step: 3, params: { path: 'y' }, result: { ok: false, kind: 'error', summary: '', preview: '', raw: '' } },
      ],
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

const makeBaseState = (): AgentState =>
  ({
    input: 'do something',
    attempts: [],
    objective: 'accomplish a task',
    projectContext: 'some project context',
    memoryContext: 'some memory',
    sessionMemory: 'some session memory',
    plan: [{ description: 'step one', tool: 'read_file', input: {} }],
    currentStep: 0,
    expectedResult: 'file contents',
    selectedTool: 'read_file',
    toolResult: {
      ok: true,
      preview: 'file content here',
      raw: 'file content here',
      kind: 'text',
      summary: '',
    },
    criticDecision: undefined,
  }) as unknown as AgentState;

describe('XML structure — supervisor prompt', () => {
  it('contains <context>, <requirements>, and <output_format> tags', () => {
    const prompt = buildSupervisorPrompt(makeBaseState());
    expect(prompt).toContain('<context>');
    expect(prompt).toContain('</context>');
    expect(prompt).toContain('<requirements>');
    expect(prompt).toContain('</requirements>');
    expect(prompt).toContain('<output_format>');
    expect(prompt).toContain('</output_format>');
  });

  it('contains the JSON-only instruction exactly once', () => {
    const prompt = buildSupervisorPrompt(makeBaseState());
    const matches = prompt.match(/Return ONLY a single valid JSON object/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it('does not contain {{JSON_ONLY}} or {{SELF_REFLECTION}} placeholders', () => {
    const prompt = buildSupervisorPrompt(makeBaseState());
    expect(prompt).not.toContain('{{JSON_ONLY}}');
    expect(prompt).not.toContain('{{SELF_REFLECTION}}');
  });
});

describe('XML structure — planner prompt', () => {
  it('contains <context>, <requirements>, and <output_format> tags', () => {
    const prompt = buildPlannerPrompt(makeBaseState());
    expect(prompt).toContain('<context>');
    expect(prompt).toContain('</context>');
    expect(prompt).toContain('<requirements>');
    expect(prompt).toContain('</requirements>');
    expect(prompt).toContain('<output_format>');
    expect(prompt).toContain('</output_format>');
  });

  it('contains the JSON-only instruction exactly once', () => {
    const prompt = buildPlannerPrompt(makeBaseState());
    const matches = prompt.match(/Return ONLY a single valid JSON object/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it('does not contain {{JSON_ONLY}} or {{SELF_REFLECTION}} placeholders', () => {
    const prompt = buildPlannerPrompt(makeBaseState());
    expect(prompt).not.toContain('{{JSON_ONLY}}');
    expect(prompt).not.toContain('{{SELF_REFLECTION}}');
  });
});

describe('XML structure — critic prompt', () => {
  it('contains <context>, <requirements>, and <output_format> tags', () => {
    const prompt = buildCriticPrompt(makeBaseState());
    expect(prompt).toContain('<context>');
    expect(prompt).toContain('</context>');
    expect(prompt).toContain('<requirements>');
    expect(prompt).toContain('</requirements>');
    expect(prompt).toContain('<output_format>');
    expect(prompt).toContain('</output_format>');
  });

  it('contains the JSON-only instruction exactly once', () => {
    const prompt = buildCriticPrompt(makeBaseState());
    const matches = prompt.match(/Return ONLY a single valid JSON object/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it('does not contain {{JSON_ONLY}} or {{SELF_REFLECTION}} placeholders', () => {
    const prompt = buildCriticPrompt(makeBaseState());
    expect(prompt).not.toContain('{{JSON_ONLY}}');
    expect(prompt).not.toContain('{{SELF_REFLECTION}}');
  });
});
