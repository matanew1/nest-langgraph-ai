import { toolRegistry } from './tool.registry';
import { searchTool } from './search.tool';
import { readFileTool } from './read-file.tool';
import { writeFileTool } from './write-file.tool';
import { listDirTool } from './list-dir.tool';

// Param hints tell the LLM what JSON shape each tool expects so it can
// produce correctly-structured params in the supervisor/planner responses.
toolRegistry.register(searchTool,    '{"query":"<search query string>"}');
toolRegistry.register(readFileTool,  '{"path":"<absolute or relative file path>"}');
toolRegistry.register(writeFileTool, '{"path":"<file path>","content":"<full file content to write>"}');
toolRegistry.register(listDirTool,   '{"path":"<absolute or relative directory path>"}');

export { toolRegistry };
