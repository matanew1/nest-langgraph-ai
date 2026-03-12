import type { StructuredToolInterface } from '@langchain/core/tools';

class ToolRegistry {
  private readonly tools = new Map<string, StructuredToolInterface>();
  private readonly paramHints = new Map<string, string>();

  register(tool: StructuredToolInterface, paramHint?: string): void {
    this.tools.set(tool.name, tool);
    if (paramHint) this.paramHints.set(tool.name, paramHint);
  }

  get(name: string): StructuredToolInterface | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  getDescriptions(): string {
    return Array.from(this.tools.values())
      .map((t) => `- ${t.name}: ${t.description}`)
      .join('\n');
  }

  getParamHint(name: string): string {
    return this.paramHints.get(name) ?? '';
  }

  getToolsWithParams(): string {
    return Array.from(this.tools.values())
      .map((t) => {
        const hint = this.paramHints.get(t.name);
        return `- ${t.name}: ${t.description}${hint ? `\n  params: ${hint}` : ''}`;
      })
      .join('\n');
  }
}

export const toolRegistry = new ToolRegistry();
