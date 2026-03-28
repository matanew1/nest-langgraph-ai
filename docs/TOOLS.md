# Agent Tool Registry

All tools are registered in `src/modules/agents/tools/tool.catalog.ts` and discovered automatically by the planner and executor. File-operation tools enforce `sandboxPath()` — all paths are resolved within `AGENT_WORKING_DIR`.

**Total tools: 25**

---

## File Operations (13 tools)

| Tool | Input hint | Description |
|------|-----------|-------------|
| `read_file` | `{"path":"<file path>"}` | Read a local file (100 KB limit, truncated with notice) |
| `write_file` | `{"path":"<file path>","content":"<content>"}` | Write/create a file; creates parent directories |
| `file_append` | `{"path":"<file path>","content":"<content>"}` | Append content to a file, inserting before the final `export {}` if present |
| `file_patch` | `{"path":"<file>","find":"<text>","replace":"<text>"}` | Find-and-replace within a file |
| `delete_file` | `{"path":"<file or empty dir>"}` | Delete a file or an empty directory |
| `move_file` | `{"from":"<source>","to":"<destination>"}` | Rename or move a file or directory |
| `list_dir` | `{"path":"<directory path>"}` | List directory contents (names + types) |
| `tree_dir` | `{"path":"<root dir path>"}` | Recursive directory tree (ignores `node_modules`, `.git`, `dist`) |
| `glob_files` | `{"root?":"<dir>","extensions?":[".ts"],"maxResults?":200}` | Bounded recursive file listing with optional extension filter |
| `read_files_batch` | `{"paths":["file1","file2"]}` | Read multiple files in one call (bounded) |
| `stat_path` | `{"path":"<path>"}` | File metadata: exists / type / size / mtime |
| `grep_search` | `{"pattern":"<regex>","path":"<dir>","glob":"*.ts"}` | Regex pattern search across files |
| `ast_parse` | `{"path":"<JS/TS file>","maxChunks":10}` | Semantic JS/TS parsing into named chunks (functions, classes, exports) |

---

## Intelligence & Search (4 tools)

| Tool | Input hint | Description |
|------|-----------|-------------|
| `search` | `{"query":"<search query>"}` | Web search via Tavily |
| `llm_summarize` | `{"content":"<text>","instruction":"<what to do>"}` | AI-powered analysis or summarisation of long content |
| `vector_upsert` | `{"text":"<text>","id?":"<id>","metadata?":{"key":"string\|number\|boolean\|null"}}` | Embed text (384-dim) and upsert into Qdrant for semantic memory |
| `vector_search` | `{"query":"<what to recall>","topK?":5}` | Embed query and search Qdrant for semantically similar memories |

---

## Diagrams (3 tools)

| Tool | Input hint | Description |
|------|-----------|-------------|
| `generate_mermaid` | `{"description":"<goal>","source?":"<text>","path":"<.mmd path>"}` | Generate a Mermaid `.mmd` diagram; pass `source` to ground it in real code |
| `read_mermaid` | `{"path":"<.mmd file>"}` | Read an existing `.mmd` diagram file |
| `edit_mermaid` | `{"path":"<.mmd file>","instruction":"<changes>"}` | Edit an existing `.mmd` diagram file with a natural-language instruction |

**Recommended pattern for accurate diagrams:**
1. `ast_parse` the source file to get real structure
2. `generate_mermaid` with `source="__PREVIOUS_RESULT__"` to prevent hallucinated nodes/edges

---

## Git

| Tool | Input hint | Description |
|------|-----------|-------------|
| `git_info` | `{"action":"status\|log\|diff\|branch\|show","args":"<optional>"}` | Whitelisted git commands (read-only) |
---

## HTTP (2 tools)

| Tool | Input hint | Description |
|------|-----------|-------------|
| `http_get` | `{"url":"<url>","headers?":{"key":"value"}}` | HTTP GET request; returns status + body (500 KB limit). SSRF-protected — private/localhost addresses blocked. Redirects re-checked on every hop. |
| `http_post` | `{"url":"<url>","body":"<string or object>","headers?":{},"contentType?":"application/json"}` | HTTP POST request; auto-serialises object body to JSON. SSRF-protected — same redirect re-checking as `http_get`. |

---

## System (2 tools)

| Tool | Input hint | Description |
|------|-----------|-------------|
| `system_info` | `{}` | Hostname, platform, memory, uptime |
| `run_command` | `{"command":"<shell command>","cwd?":"<subdir>","timeout?":15000}` | Run a shell command inside the agent working directory. Returns stdout + stderr combined (100 KB limit). |

---

## Vector Memory Tips

- **Recall first:** `vector_search` early in planning so prior knowledge informs the plan.
- **Store after success:** `vector_upsert` after a step completes to persist facts, decisions, or summaries.
- **Size must match:** `QDRANT_VECTOR_SIZE` must match the embedding model dimension (default: **384** for `all-MiniLM-L6-v2`).

---

## Adding a New Tool

1. Create `src/modules/agents/tools/<name>.tool.ts` — export a `ToolDefinition` with a Zod input schema and `execute()` function.
2. Register in `src/modules/agents/tools/tool.catalog.ts`.
3. The tool is automatically available to the planner (`availableTools` prompt context) and executor.
