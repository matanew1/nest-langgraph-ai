# Agent Tool Registry

### File Operations (Enforced via `sandboxPath`)
- `read_file`: Reads local file (truncates @ 100KB).
- `write_file`: Writes content + creates parent dirs.
- `tree_dir`: Recursive tree (ignores node_modules/git/dist).
- `grep_search`: Regex pattern matching across files.
- `ast_parse`: Semantic JS/TS parsing into chunks.

### Intelligence & Search
- `search`: Web search via Tavily.
- `llm_summarize`: AI-powered analysis of long content.
- `vector_search/upsert`: Qdrant memory operations (384 dims).

### Infrastructure
- `analyze_logs`: Splunk SPL query + AI analysis.
- `detect_root_cause`: Structured RCA report from Splunk.
- `git_info`: Whitelisted git commands (status, log, diff).
- `generate_mermaid`: Creates `.mmd` diagrams from text.