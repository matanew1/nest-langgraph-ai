import type { StructuredToolInterface } from '@langchain/core/tools';

export interface ToolRegistration {
  tool: StructuredToolInterface;
  paramHint?: string;
}

export interface ToolPromptMetadata {
  name: string;
  description: string;
  paramHint?: string;
}

export class ToolRegistry {
  private readonly tools = new Map<string, StructuredToolInterface>();
  private readonly paramHints = new Map<string, string>();

  register(tool: StructuredToolInterface, paramHint?: string): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }

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

  list(): ToolPromptMetadata[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      paramHint: this.paramHints.get(tool.name),
    }));
  }

  getDescriptions(): string {
    return this.list()
      .map((tool) => `- ${tool.name}: ${tool.description}`)
      .join('\n');
  }

  getParamHint(name: string): string {
    return this.paramHints.get(name) ?? '';
  }

  describeForPrompt(options?: {
    excludeNames?: Iterable<string>;
  }): string {
    const excluded = new Set(options?.excludeNames ?? []);

    return this.list()
      .filter((tool) => !excluded.has(tool.name))
      .map((tool) => {
        return `- ${tool.name}: ${tool.description}${tool.paramHint ? `\n  params: ${tool.paramHint}` : ''}`;
      })
      .join('\n');
  }

  static from(registrations: ToolRegistration[]): ToolRegistry {
    const registry = new ToolRegistry();
    registry.registerAll(registrations);
    return registry;
  }
}
