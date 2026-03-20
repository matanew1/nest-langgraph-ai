import {
  renderPromptTemplate,
  getPromptTemplate,
  PromptTemplateName,
} from './prompt-template.util';

// Mock fs.readFileSync so tests don't depend on actual template files
jest.mock('node:fs', () => ({
  readFileSync: jest.fn((filePath: string) => {
    if (filePath.includes('supervisor.txt'))
      return 'Supervisor: {{JSON_ONLY}} input={{input}}';
    if (filePath.includes('planner.txt'))
      return 'Planner: {{objective}} tools={{availableTools}}';
    if (filePath.includes('critic.txt'))
      return 'Critic: step={{currentStep}} total={{totalSteps}}';
    throw new Error(`Unknown template: ${filePath}`);
  }),
}));

describe('renderPromptTemplate', () => {
  it('replaces a single {{name}} placeholder with its value', () => {
    const result = renderPromptTemplate('Hello {{name}}!', { name: 'World' });
    expect(result).toBe('Hello World!');
  });

  it('replaces multiple distinct placeholders', () => {
    const result = renderPromptTemplate('User: {{user}} Task: {{task}}', {
      user: 'Alice',
      task: 'code review',
    });
    expect(result).toBe('User: Alice Task: code review');
  });

  it('replaces the same placeholder when it appears twice', () => {
    const result = renderPromptTemplate('{{greeting}} there, {{greeting}}!', {
      greeting: 'Hello',
    });
    expect(result).toBe('Hello there, Hello!');
  });

  it('leaves a placeholder unchanged when no matching var exists', () => {
    const result = renderPromptTemplate('Hello {{unknown}} world', {
      name: 'Alice',
    });
    expect(result).toBe('Hello {{unknown}} world');
  });

  it('returns the template unchanged when it has no placeholders', () => {
    const template = 'No placeholders here.';
    const result = renderPromptTemplate(template, { name: 'value' });
    expect(result).toBe(template);
  });

  it('handles an empty vars object and leaves all placeholders', () => {
    const result = renderPromptTemplate('{{a}} and {{b}}', {});
    expect(result).toBe('{{a}} and {{b}}');
  });

  it('handles empty template string', () => {
    const result = renderPromptTemplate('', { name: 'value' });
    expect(result).toBe('');
  });

  it('replaces only the matching variable and leaves others', () => {
    const result = renderPromptTemplate('{{a}} {{b}} {{c}}', {
      a: 'alpha',
      c: 'charlie',
    });
    expect(result).toBe('alpha {{b}} charlie');
  });
});

describe('getPromptTemplate', () => {
  it('returns a non-empty string for "supervisor"', () => {
    const template = getPromptTemplate('supervisor');
    expect(typeof template).toBe('string');
    expect(template.length).toBeGreaterThan(0);
  });

  it('returns a non-empty string for "planner"', () => {
    const template = getPromptTemplate('planner');
    expect(typeof template).toBe('string');
    expect(template.length).toBeGreaterThan(0);
  });

  it('returns a non-empty string for "critic"', () => {
    const template = getPromptTemplate('critic');
    expect(typeof template).toBe('string');
    expect(template.length).toBeGreaterThan(0);
  });

  it('supervisor template contains expected placeholders', () => {
    const template = getPromptTemplate('supervisor');
    expect(template).toContain('{{JSON_ONLY}}');
    expect(template).toContain('{{input}}');
  });

  it('planner template contains expected placeholders', () => {
    const template = getPromptTemplate('planner');
    expect(template).toContain('{{objective}}');
  });

  it('critic template contains expected placeholders', () => {
    const template = getPromptTemplate('critic');
    expect(template).toContain('{{currentStep}}');
  });

  it('TypeScript type prevents invalid template names at compile time', () => {
    // This is a type-level test — only valid names are accepted by PromptTemplateName
    const validNames: PromptTemplateName[] = [
      'supervisor',
      'planner',
      'critic',
    ];
    for (const name of validNames) {
      expect(() => getPromptTemplate(name)).not.toThrow();
    }
  });
});
