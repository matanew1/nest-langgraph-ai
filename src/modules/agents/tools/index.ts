import { toolRegistry } from './tool.registry';
import { searchTool } from './search.tool';
import { readFileTool } from './read-file.tool';
import { writeFileTool } from './write-file.tool';
import { listDirTool } from './list-dir.tool';
import { treeDirTool } from './tree-dir.tool';
import { shellRunTool } from './shell-run.tool';
import { llmSummarizeTool } from './llm-summarize.tool';
import { gitInfoTool } from './git-info.tool';
import { grepSearchTool } from './grep-search.tool';
import { filePatchTool } from './file-patch.tool';
import { drawioTool } from './drawio.tool';
import { astParseTool } from './ast-parse.tool';

// Param hints tell the LLM what JSON shape each tool expects so it can
// produce correctly-structured params in the supervisor/planner responses.
toolRegistry.register(searchTool, '{"query":"<search query string>"}');
toolRegistry.register(
  readFileTool,
  '{"path":"<absolute or relative file path>"}',
);
toolRegistry.register(
  writeFileTool,
  '{"path":"<file path>","content":"<full file content to write>"}',
);
toolRegistry.register(
  listDirTool,
  '{"path":"<absolute or relative directory path>"}',
);
toolRegistry.register(
  treeDirTool,
  '{"path":"<absolute or relative root directory path>"}',
);
toolRegistry.register(shellRunTool, '{"command":"<shell command to execute>"}');
toolRegistry.register(
  llmSummarizeTool,
  '{"content":"<text to analyse>","instruction":"<what to do with it>","outputType":"text|code"}',
);
toolRegistry.register(
  gitInfoTool,
  '{"action":"status|log|diff|branch|show","args":"<optional extra args>"}',
);
toolRegistry.register(
  grepSearchTool,
  '{"pattern":"<text or regex>","path":"<dir (default .)>","glob":"<e.g. *.ts>"}',
);
toolRegistry.register(
  filePatchTool,
  '{"path":"<file path>","find":"<exact text to find>","replace":"<replacement text>"}',
);
toolRegistry.register(
  drawioTool,
  '{"description":"<diagram description>","path":"<output file path e.g. diagrams/arch.drawio>"}',
);

toolRegistry.register(
  astParseTool,
  '{"path":"<JS/TS file path>","maxChunks":10}',
);

export { toolRegistry };
