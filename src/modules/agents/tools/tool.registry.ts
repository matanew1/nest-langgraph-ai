import type { StructuredToolInterface } from '@langchain/core/tools';

export type ToolRiskLevel =
  | 'read_only'
  | 'network_read'
  | 'write'
  | 'network_write'
  | 'execute';

export interface ToolCapabilityMetadata {
  risk: ToolRiskLevel;
  parallelSafe: boolean;
}

export interface ToolRegistration {
  tool: StructuredToolInterface;
  paramHint?: string;
  capability?: ToolCapabilityMetadata;
}

export interface ToolPromptMetadata {
  name: string;
  description: string;
  paramHint?: string;
  capability: ToolCapabilityMetadata;
}

const DEFAULT_TOOL_CAPABILITY: ToolCapabilityMetadata = {
  risk: 'execute',
  parallelSafe: false,
};

export class ToolRegistry {
  private readonly tools = new Map<string, StructuredToolInterface>();
  private readonly paramHints = new Map<string, string>();
  private readonly descriptionCache = new Map<string, string>();
  private readonly capabilityPromptCache = new Map<string, string>();
  private readonly capabilities = new Map<string, ToolCapabilityMetadata>();

  register(
    tool: StructuredToolInterface,
    paramHint?: string,
    capability: ToolCapabilityMetadata = DEFAULT_TOOL_CAPABILITY,
  ): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }

    this.tools.set(tool.name, tool);
    if (paramHint) this.paramHints.set(tool.name, paramHint);
    this.capabilities.set(tool.name, capability);
  }

  registerAll(registrations: ToolRegistration[]): void {
    for (const r of registrations)
      this.register(r.tool, r.paramHint, r.capability);
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

  getCapability(name: string): ToolCapabilityMetadata | undefined {
    return this.capabilities.get(name);
  }

  list(): ToolPromptMetadata[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      paramHint: this.paramHints.get(tool.name),
      capability:
        this.capabilities.get(tool.name) ?? DEFAULT_TOOL_CAPABILITY,
    }));
  }

  describeForPrompt(options?: { excludeNames?: Iterable<string> }): string {
    const excluded = new Set(options?.excludeNames ?? []);
    const cacheKey = Array.from(excluded).sort().join(',');

    const cached = this.descriptionCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const result = this.list()
      .filter((tool) => !excluded.has(tool.name))
      .map((tool) => {
        return (
          `- ${tool.name}: ${tool.description}` +
          (tool.paramHint ? `\n  params: ${tool.paramHint}` : '') +
          `\n  capability: risk=${tool.capability.risk}; parallel_safe=${tool.capability.parallelSafe ? 'yes' : 'no'}`
        );
      })
      .join('\n');

    this.descriptionCache.set(cacheKey, result);
    return result;
  }

  describeCapabilitiesForPrompt(options?: {
    excludeNames?: Iterable<string>;
  }): string {
    const excluded = new Set(options?.excludeNames ?? []);
    const cacheKey = Array.from(excluded).sort().join(',');

    const cached = this.capabilityPromptCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const result = this.list()
      .filter((tool) => !excluded.has(tool.name))
      .map(
        (tool) =>
          `- ${tool.name}: risk=${tool.capability.risk}; parallel_safe=${tool.capability.parallelSafe ? 'yes' : 'no'}`,
      )
      .join('\n');

    this.capabilityPromptCache.set(cacheKey, result);
    return result;
  }

  static from(registrations: ToolRegistration[]): ToolRegistry {
    const registry = new ToolRegistry();
    registry.registerAll(registrations);
    return registry;
  }
}
