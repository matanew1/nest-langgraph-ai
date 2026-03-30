import type { StructuredToolInterface } from '@langchain/core/tools';
import { ToolRegistry } from './tool.registry';

function makeTool(name: string, description: string): StructuredToolInterface {
  return {
    name,
    description,
  } as StructuredToolInterface;
}

describe('ToolRegistry', () => {
  it('describes tools for prompts with optional exclusions', () => {
    const registry = ToolRegistry.from([
      {
        tool: makeTool('search', 'search docs'),
        paramHint: '{"query":"q"}',
        capability: { risk: 'network_read', parallelSafe: true },
      },
      {
        tool: makeTool('read_file', 'read files'),
        capability: { risk: 'read_only', parallelSafe: true },
      },
    ]);

    expect(
      registry.describeForPrompt({ excludeNames: new Set(['read_file']) }),
    ).toContain('- search: search docs');
    expect(
      registry.describeForPrompt({ excludeNames: new Set(['read_file']) }),
    ).toContain('risk=network_read; parallel_safe=yes');
    expect(
      registry.describeForPrompt({ excludeNames: new Set(['read_file']) }),
    ).not.toContain('read_file');
  });

  it('provides a separate capability manifest for prompts', () => {
    const registry = ToolRegistry.from([
      {
        tool: makeTool('file_patch', 'patch files'),
        capability: { risk: 'write', parallelSafe: false },
      },
    ]);

    expect(registry.describeCapabilitiesForPrompt()).toContain(
      '- file_patch: risk=write; parallel_safe=no',
    );
    expect(registry.getCapability('file_patch')).toEqual({
      risk: 'write',
      parallelSafe: false,
    });
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
