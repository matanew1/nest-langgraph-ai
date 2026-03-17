import { ToolRegistry } from './tool.registry';
import { toolRegistrations } from './tool.catalog';

export const toolRegistry = ToolRegistry.from(toolRegistrations);

export { toolRegistrations } from './tool.catalog';
