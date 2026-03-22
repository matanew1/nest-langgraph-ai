import type { ToolRegistration } from './tool.registry';
import { searchTool } from './search.tool';
import { readFileTool } from './read-file.tool';
import { writeFileTool } from './write-file.tool';
import { listDirTool } from './list-dir.tool';
import { treeDirTool } from './tree-dir.tool';
import { llmSummarizeTool } from './llm-summarize.tool';
import { gitInfoTool } from './git-info.tool';
import { grepSearchTool } from './grep-search.tool';
import { filePatchTool } from './file-patch.tool';
import { fileAppendTool } from './file-append.tool';
import { astParseTool } from './ast-parse.tool';
import { systemInfoTool } from './system-info.tool';
import { globFilesTool } from './glob-files.tool';
import { readFilesBatchTool } from './read-files-batch.tool';
import { statPathTool } from './stat-path.tool';
import { generateMermaidTool } from './generate-mermaid.tool';
import { readMermaidTool } from './read-mermaid.tool';
import { editMermaidTool } from './edit-mermaid.tool';
import { vectorUpsertTool } from './vector-upsert.tool';
import { vectorSearchTool } from './vector-search.tool';

export const toolRegistrations: ToolRegistration[] = [
  { tool: searchTool, paramHint: '{"query":"<search query string>"}' },
  {
    tool: readFileTool,
    paramHint: '{"path":"<absolute or relative file path>"}',
  },
  {
    tool: writeFileTool,
    paramHint: '{"path":"<file path>","content":"<full file content>"}',
  },
  {
    tool: listDirTool,
    paramHint: '{"path":"<absolute or relative directory path>"}',
  },
  {
    tool: treeDirTool,
    paramHint: '{"path":"<absolute or relative root directory path>"}',
  },
  {
    tool: llmSummarizeTool,
    paramHint:
      '{"content":"<text to analyse>","instruction":"<what to do with it>"}',
  },
  {
    tool: gitInfoTool,
    paramHint:
      '{"action":"status|log|diff|branch|show","args":"<optional extra args>"}',
  },
  {
    tool: grepSearchTool,
    paramHint:
      '{"pattern":"<text or regex>","path":"<dir (default .)>","glob":"<e.g. *.ts>"}',
  },
  {
    tool: filePatchTool,
    paramHint:
      '{"path":"<file path>","find":"<exact text to find>","replace":"<replacement text>"}',
  },
  {
    tool: fileAppendTool,
    paramHint: '{"path":"<file path>","content":"<content to append>"}',
  },
  {
    tool: generateMermaidTool,
    paramHint:
      '{"description":"<diagram goal/instructions>","source?":"<authoritative text>","path":"<output .mmd path>"}',
  },
  { tool: readMermaidTool, paramHint: '{"path":"<.mmd file path>"}' },
  {
    tool: editMermaidTool,
    paramHint:
      '{"path":"<.mmd file path>","instruction":"<how to change the diagram>"}',
  },
  {
    tool: astParseTool,
    paramHint: '{"path":"<JS/TS file path>","maxChunks":10}',
  },
  { tool: systemInfoTool, paramHint: '{}' },

  {
    tool: globFilesTool,
    paramHint:
      '{"root?":"<dir (default .)>","extensions?":[".ts",".md"],"maxResults?":200}',
  },
  { tool: readFilesBatchTool, paramHint: '{"paths":["file1","file2"]}' },
  { tool: statPathTool, paramHint: '{"path":"<path>"}' },
  {
    tool: vectorUpsertTool,
    paramHint:
      '{"text":"<text to remember>","id?":"<optional stable id>","metadata?":{"any":"json"}}',
  },
  {
    tool: vectorSearchTool,
    paramHint: '{"query":"<what to recall>","topK?":5}',
  },
];
