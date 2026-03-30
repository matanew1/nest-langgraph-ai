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
import { runCommandTool } from './run-command.tool';
import { deleteFileTool } from './delete-file.tool';
import { moveFileTool } from './move-file.tool';
import { httpGetTool } from './http-get.tool';
import { httpPostTool } from './http-post.tool';
import { repoImpactRadarTool } from './repo-impact-radar.tool';

export const toolRegistrations: ToolRegistration[] = [
  {
    tool: searchTool,
    paramHint: '{"query":"<search query string>"}',
    capability: { risk: 'network_read', parallelSafe: true },
  },
  {
    tool: readFileTool,
    paramHint: '{"path":"<absolute or relative file path>"}',
    capability: { risk: 'read_only', parallelSafe: true },
  },
  {
    tool: writeFileTool,
    paramHint: '{"path":"<file path>","content":"<full file content>"}',
    capability: { risk: 'write', parallelSafe: false },
  },
  {
    tool: listDirTool,
    paramHint: '{"path":"<absolute or relative directory path>"}',
    capability: { risk: 'read_only', parallelSafe: true },
  },
  {
    tool: treeDirTool,
    paramHint: '{"path":"<absolute or relative root directory path>"}',
    capability: { risk: 'read_only', parallelSafe: true },
  },
  {
    tool: llmSummarizeTool,
    paramHint:
      '{"content":"<text to analyse>","instruction":"<what to do with it>"}',
    capability: { risk: 'read_only', parallelSafe: true },
  },
  {
    tool: gitInfoTool,
    paramHint:
      '{"action":"status|log|diff|branch|show","args":"<optional extra args>"}',
    capability: { risk: 'read_only', parallelSafe: true },
  },
  {
    tool: grepSearchTool,
    paramHint:
      '{"pattern":"<text or regex>","path":"<dir (default .)>","glob":"<e.g. *.ts>"}',
    capability: { risk: 'read_only', parallelSafe: true },
  },
  {
    tool: filePatchTool,
    paramHint:
      '{"path":"<file path>","find":"<exact text to find>","replace":"<replacement text>"}',
    capability: { risk: 'write', parallelSafe: false },
  },
  {
    tool: fileAppendTool,
    paramHint: '{"path":"<file path>","content":"<content to append>"}',
    capability: { risk: 'write', parallelSafe: false },
  },
  {
    tool: generateMermaidTool,
    paramHint:
      '{"description":"<diagram goal/instructions>","source?":"<authoritative text>","path":"<output .mmd path>"}',
    capability: { risk: 'write', parallelSafe: false },
  },
  {
    tool: readMermaidTool,
    paramHint: '{"path":"<.mmd file path>"}',
    capability: { risk: 'read_only', parallelSafe: true },
  },
  {
    tool: editMermaidTool,
    paramHint:
      '{"path":"<.mmd file path>","instruction":"<how to change the diagram>"}',
    capability: { risk: 'write', parallelSafe: false },
  },
  {
    tool: astParseTool,
    paramHint: '{"path":"<JS/TS file path>","maxChunks":10}',
    capability: { risk: 'read_only', parallelSafe: true },
  },
  {
    tool: systemInfoTool,
    paramHint: '{}',
    capability: { risk: 'read_only', parallelSafe: true },
  },

  {
    tool: globFilesTool,
    paramHint:
      '{"root?":"<dir (default .)>","extensions?":[".ts",".md"],"maxResults?":200}',
    capability: { risk: 'read_only', parallelSafe: true },
  },
  {
    tool: readFilesBatchTool,
    paramHint: '{"paths":["file1","file2"]}',
    capability: { risk: 'read_only', parallelSafe: true },
  },
  {
    tool: statPathTool,
    paramHint: '{"path":"<path>"}',
    capability: { risk: 'read_only', parallelSafe: true },
  },
  {
    tool: repoImpactRadarTool,
    paramHint:
      '{"objective":"<change objective>","hints?":["file","symbol"],"maxResults?":8,"includeTests?":true}',
    capability: { risk: 'read_only', parallelSafe: true },
  },
  {
    tool: vectorUpsertTool,
    paramHint:
      '{"text":"<text to remember>","id?":"<optional stable id>","metadata?":{"key":"string|number|boolean|null"}}',
    capability: { risk: 'write', parallelSafe: false },
  },
  {
    tool: vectorSearchTool,
    paramHint: '{"query":"<what to recall>","topK?":5}',
    capability: { risk: 'read_only', parallelSafe: true },
  },
  {
    tool: runCommandTool,
    paramHint: '{"command":"<shell command>","cwd?":"<subdir>","timeout?":15000}',
    capability: { risk: 'execute', parallelSafe: false },
  },
  {
    tool: deleteFileTool,
    paramHint: '{"path":"<file or empty dir to delete>"}',
    capability: { risk: 'write', parallelSafe: false },
  },
  {
    tool: moveFileTool,
    paramHint: '{"from":"<source path>","to":"<destination path>"}',
    capability: { risk: 'write', parallelSafe: false },
  },
  {
    tool: httpGetTool,
    paramHint: '{"url":"<https://...>","headers?":{"Authorization":"Bearer token"}}',
    capability: { risk: 'network_read', parallelSafe: true },
  },
  {
    tool: httpPostTool,
    paramHint:
      '{"url":"<https://...>","body":"<string or object>","headers?":{},"contentType?":"application/json"}',
    capability: { risk: 'network_write', parallelSafe: false },
  },
];
