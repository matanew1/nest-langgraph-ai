import type { StructuredToolInterface } from '@langchain/core/tools';
import { ToolRegistry } from './tool.registry';

function makeTool(
  name: string,
  description: string,
): StructuredToolInterface {
  return {
    name,
    description,
  } as StructuredToolInterface;
}

describe('ToolRegistry', () => {
  it('describes tools for prompts with optional exclusions', () => {
    const registry = ToolRegistry.from([
      { tool: makeTool('search', 'search docs'), paramHint: '{"query":"q"}' },
      { tool: makeTool('read_file', 'read files') },
    ]);

    expect(
      registry.describeForPrompt({ excludeNames: new Set(['read_file']) }),
    ).toContain('- search: search docs');
    expect(
      registry.describeForPrompt({ excludeNames: new Set(['read_file']) }),
    ).not.toContain('read_file');
  });

  it('throws when the same tool is registered twice', () => {
    const registry = new ToolRegistry();
    const tool = makeTool('search', 'search docs');

    registry.register(tool);

    expect(() => registry.register(tool)).toThrow(
      'Tool "search" is already registered',
    );
  });
});
