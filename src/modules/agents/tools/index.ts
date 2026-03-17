import { ToolRegistryBuilder } from './tool.registry';
import { searchTool } from './search.tool';
import { readFileTool } from './read-file.tool';
import { writeFileTool } from './write-file.tool';
import { listDirTool } from './list-dir.tool';
import { treeDirTool } from './tree-dir.tool';
import { llmSummarizeTool } from './llm-summarize.tool';
import { gitInfoTool } from './git-info.tool';
import { grepSearchTool } from './grep-search.tool';
import { filePatchTool } from './file-patch.tool';
import { astParseTool } from './ast-parse.tool';
import { systemInfoTool } from './system-info.tool';
import { httpGetTool } from './http-get.tool';
import { httpPostTool } from './http-post.tool';
import { globFilesTool } from './glob-files.tool';
import { readFilesBatchTool } from './read-files-batch.tool';
import { statPathTool } from './stat-path.tool';
import { generateMermaidTool } from './generate-mermaid.tool';
import { readMermaidTool } from './read-mermaid.tool';
import { editMermaidTool } from './edit-mermaid.tool';
import { vectorUpsertTool } from './vector-upsert.tool';
import { vectorSearchTool } from './vector-search.tool';

// Param hints tell the LLM what JSON shape each tool expects so it can
// produce correctly-structured params in the supervisor/planner responses.
const built = new ToolRegistryBuilder()
  .add(searchTool, '{"query":"<search query string>"}')
  .add(readFileTool, '{"path":"<absolute or relative file path>"}')
  .add(writeFileTool, '{"path":"<file path>","content":"<full file content>"}')
  .add(listDirTool, '{"path":"<absolute or relative directory path>"}')
  .add(treeDirTool, '{"path":"<absolute or relative root directory path>"}')
  .add(
    llmSummarizeTool,
    '{"content":"<text to analyse>","instruction":"<what to do with it>"}',
  )
  .add(
    gitInfoTool,
    '{"action":"status|log|diff|branch|show","args":"<optional extra args>"}',
  )
  .add(
    grepSearchTool,
    '{"pattern":"<text or regex>","path":"<dir (default .)>","glob":"<e.g. *.ts>"}',
  )
  .add(
    filePatchTool,
    '{"path":"<file path>","find":"<exact text to find>","replace":"<replacement text>"}',
  )
  .add(
    generateMermaidTool,
    '{"description":"<diagram goal/instructions>","source?":"<authoritative text>","path":"<output .mmd path>"}',
  )
  .add(readMermaidTool, '{"path":"<.mmd file path>"}')
  .add(
    editMermaidTool,
    '{"path":"<.mmd file path>","instruction":"<how to change the diagram>"}',
  )
  .add(astParseTool, '{"path":"<JS/TS file path>","maxChunks":10}')
  .add(systemInfoTool, '{}')
  .add(httpGetTool, '{"url":"<valid http url>"}')
  .add(
    httpPostTool,
    '{"url":"<url>","body":"<json string>","headers?":"<optional json string>"}',
  )
  .add(
    globFilesTool,
    '{"root?":"<dir (default .)>","extensions?":[".ts",".md"],"maxResults?":200}',
  )
  .add(readFilesBatchTool, '{"paths":["file1","file2"]}')
  .add(statPathTool, '{"path":"<path>"}')
  .add(
    vectorUpsertTool,
    '{"text":"<text to remember>","id?":"<optional stable id>","metadata?":{"any":"json"}}',
  )
  .add(vectorSearchTool, '{"query":"<what to recall>","topK?":5}')
  .build();

export const toolRegistry = built;
