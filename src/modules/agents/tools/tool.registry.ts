import type { StructuredToolInterface } from '@langchain/core/tools';

export interface ToolRegistration {
  tool: StructuredToolInterface;
  paramHint?: string;
}

export class ToolRegistry {
  private readonly tools = new Map<string, StructuredToolInterface>();
  private readonly paramHints = new Map<string, string>();

  register(tool: StructuredToolInterface, paramHint?: string): void {
    this.tools.set(tool.name, tool);
    if (paramHint) this.paramHints.set(tool.name, paramHint);
  }

  registerAll(registrations: ToolRegistration[]): void {
    for (const r of registrations) this.register(r.tool, r.paramHint);
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

export class ToolRegistryBuilder {
  private readonly registrations: ToolRegistration[] = [];

  add(tool: StructuredToolInterface, paramHint?: string): this {
    this.registrations.push({ tool, paramHint });
    return this;
  }

  build(): ToolRegistry {
    const registry = new ToolRegistry();
    registry.registerAll(this.registrations);
    return registry;
  }
}
