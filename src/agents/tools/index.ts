import { toolRegistry } from './tool.registry';
import { searchTool } from './search.tool';
import { readFileTool } from './read-file.tool';
import { writeFileTool } from './write-file.tool';
import { listDirTool } from './list-dir.tool';

toolRegistry.register(searchTool);
toolRegistry.register(readFileTool);
toolRegistry.register(writeFileTool);
toolRegistry.register(listDirTool);

export { toolRegistry };
