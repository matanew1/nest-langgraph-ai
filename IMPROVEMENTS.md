# Improvements & Roadmap

This document outlines planned improvements, new graph nodes, and new tools for the
`nest-langgraph-ai` project based on a review of the current codebase (March 2026).

---

## 1. Code Quality & Housekeeping

### 1.1 Remove Dead Code

| Path | Issue | Action |
|------|-------|--------|
| `src/core/providers/` | Duplicate of `src/agents/providers/` | Delete |
| `src/core/utils/` | Duplicate of `src/utils/` | Delete |
| `src/modules/agents/` | Duplicate of `src/agents/state/` + `src/agents/tools/` | Delete |

These directories are not imported anywhere. Leaving them creates confusion about the canonical
source of truth and increases repository size unnecessarily.

### 1.2 Fix Outdated E2E Test

`test/app.e2e-spec.ts` currently expects `GET /` → `"Hello World!"`, which is a stale NestJS
boilerplate assertion. Replace with real integration tests:

```
test/
├── health.e2e-spec.ts       # GET /health → { status: "ok", redis: ..., timestamp: ... }
└── agents.e2e-spec.ts       # POST /api/agents/run with mocked LLM + Redis
```

### 1.3 Enable Stricter TypeScript

Set `noImplicitAny: true` in `tsconfig.json` and fix any resulting type errors. The codebase
already has `strictNullChecks: true`; going fully strict prevents an entire class of runtime bugs.

### 1.4 Update README.md

Replace the generic NestJS template README with project-specific documentation covering setup,
environment variables, API usage, and architecture overview.

---

## 2. Architecture Improvements

### 2.1 Parallel Tool Execution Node

**Problem:** The current graph executes one tool per iteration. For prompts that need multiple
independent data points (e.g. "Compare today's BTC and ETH prices"), the agent wastes iterations
by serializing what could run concurrently.

**Solution:** Add a `PARALLEL_EXECUTE` node that accepts a list of tool calls from a planner
variant and runs them concurrently with `Promise.allSettled`.

**Graph change:**
```
SUPERVISOR → PARALLEL_PLANNER → PARALLEL_EXECUTE → CRITIC
```

### 2.2 Semantic Cache

**Problem:** The current SHA256 cache key misses semantically equivalent prompts ("BTC price" vs
"Bitcoin price today").

**Solution:** Generate a text embedding (e.g. via a local `@xenova/transformers` model or Groq
embedding endpoint), then use approximate nearest-neighbor lookup in Redis (RedisStack with
`HNSW` index) before falling back to exact SHA256.

New env var: `SEMANTIC_CACHE_THRESHOLD` (cosine similarity, default `0.92`).

### 2.3 Structured Logging & Observability

**Problem:** Logging uses `console.log/error` directly in several nodes and services.

**Solution:**
- Replace with NestJS `Logger` service throughout
- Add a `X-Request-Id` header (UUID v4 generated in `main.ts` middleware) propagated through
  agent state so all log lines for one request share a trace ID
- Export OpenTelemetry spans for each node execution (Jaeger / OTLP compatible)

New env vars: `OTEL_EXPORTER_OTLP_ENDPOINT`, `LOG_LEVEL` (default `info`).

### 2.4 Human-in-the-Loop Checkpoint

**Problem:** There is no way to pause execution and ask the user for clarification mid-graph.

**Solution:** Add an optional `INTERRUPT` node (LangGraph `interrupt()` API) after SUPERVISOR that
emits a `data: {"node":"interrupt","data":{"question":"..."}}` SSE event and awaits a
`POST /api/agents/resume` call. Only active when `HUMAN_IN_LOOP=true` env var is set.

### 2.5 Retry / Back-off in LLM Provider

**Problem:** LLM calls fail permanently on transient network errors.

**Solution:** Wrap `invokeLlm()` with exponential back-off (up to 3 retries, starting at 500 ms)
using a simple utility, before raising to the caller.

---

## 3. New Graph Nodes

### 3.1 `VALIDATOR` Node

**Position in graph:** Between PLANNER and EXECUTE.

**Responsibility:** Statically validate that `state.toolParams` satisfy the Zod schema of
`state.selectedTool` before actually invoking it. If validation fails, feed the error back to
PLANNER for a retry without burning a full iteration on an obvious param mistake.

**File:** `src/agents/nodes/validator.node.ts`

**State changes:**
- Adds `validationError: string` to `AgentState`
- Graph adds conditional edge: validation error → PLANNER (retry), no error → EXECUTE

```typescript
// Rough shape
export async function validatorNode(state: AgentState): Promise<Partial<AgentState>> {
  const tool = toolRegistry.get(state.selectedTool);
  const result = tool.schema.safeParse(state.toolParams);
  if (!result.success) {
    return { validationError: result.error.message };
  }
  return { validationError: '' };
}
```

### 3.2 `REFLECTOR` Node

**Position in graph:** Before SUPERVISOR on iterations > 1.

**Responsibility:** Summarise the `attempts` history into a concise "lessons learned" string that
is injected into the Supervisor/Planner prompts. Prevents the LLM from repeating the same failing
strategy across multiple iterations.

**File:** `src/agents/nodes/reflector.node.ts`

**State changes:**
- Adds `reflection: string` to `AgentState` (used by Supervisor + Planner prompt builders)

**Prompt builder addition** (`agent.prompts.ts`):
```
buildReflectorPrompt(attempts: Attempt[]): string
```

### 3.3 `SUMMARIZER` Node

**Position in graph:** After EXECUTE, before CRITIC, when `toolResult` exceeds
`CRITIC_RESULT_MAX_CHARS`.

**Responsibility:** Condense long tool results (e.g. large file reads, verbose search responses)
into a focused excerpt relevant to `state.input`. Reduces token cost and improves critic accuracy.

**File:** `src/agents/nodes/summarizer.node.ts`

**State changes:** Overwrites `toolResult` with the condensed version; original is stored in
`rawToolResult: string` for debugging.

**Activation:** Conditional edge from EXECUTE → SUMMARIZER when
`toolResult.length > CRITIC_RESULT_MAX_CHARS`, otherwise EXECUTE → CRITIC directly.

### 3.4 `ROUTER` Node (Multi-Agent Handoff)

**Position in graph:** After SUPERVISOR, as an alternative to PLANNER.

**Responsibility:** For complex prompts, detect that the task requires a *specialist sub-agent*
(e.g. "code review", "data analysis") and hand off to a nested LangGraph that is purpose-built
for that domain. Returns when the sub-agent completes.

**File:** `src/agents/nodes/router.node.ts`

**State changes:**
- Adds `routedTo: string` (name of sub-agent, or empty for normal flow)
- Adds `subAgentResult: string`

---

## 4. New Tools

### 4.1 `fetch_url`

**File:** `src/agents/tools/fetch-url.tool.ts`

**Params:** `{ "url": "<https://...>", "selector"?: "<CSS selector>" }`

**Description:** Performs an HTTP GET, strips HTML to markdown (via `turndown`), optionally
narrows to a CSS selector (via `cheerio`). Useful for reading documentation, APIs, or news pages.

**Security:** URL allow-list via env var `ALLOWED_URL_PATTERNS` (regex list). Blocks `localhost`,
`169.254.0.0/16` (AWS metadata), and private RFC-1918 ranges via IP check before fetch.

**New dependencies:** `turndown`, `cheerio`, `is-ip`

### 4.2 `execute_code`

**File:** `src/agents/tools/execute-code.tool.ts`

**Params:** `{ "language": "javascript" | "python" | "bash", "code": "<string>", "timeout_ms"?: number }`

**Description:** Runs a code snippet in an isolated sandbox. Uses Node.js `vm` module for
JavaScript (no network, no file system), `execa` with `--no-network` Bubblewrap for Python/Bash.

**Security:** Requires `CODE_EXECUTION_ENABLED=true` env var (opt-in). Hard cap of 10 s execution.
No network access inside sandbox. File writes restricted to `AGENT_WORKING_DIR`.

**New dependencies:** `execa`, optionally `isolated-vm` for stronger JS isolation

### 4.3 `append_file`

**File:** `src/agents/tools/append-file.tool.ts`

**Params:** `{ "path": "<path>", "content": "<text>" }`

**Description:** Appends text to an existing file (or creates it). Complements `write_file` for
log-style or incremental writes without overwriting existing content.

**Security:** Same `sandboxPath()` enforcement as other file tools.

### 4.4 `delete_file`

**File:** `src/agents/tools/delete-file.tool.ts`

**Params:** `{ "path": "<path>" }`

**Description:** Deletes a single file within the sandbox. Requires the file to exist and be a
regular file (not a directory) to prevent accidental subtree deletion.

**Security:** Same `sandboxPath()` enforcement. Does NOT allow directory deletion.

### 4.5 `diff_file`

**File:** `src/agents/tools/diff-file.tool.ts`

**Params:** `{ "path": "<path>", "new_content": "<text>" }`

**Description:** Returns a unified diff between the current file content and `new_content` without
writing anything. Allows the CRITIC to review a proposed change before committing it via
`write_file`.

**New dependency:** `diff` (npm package)

### 4.6 `run_shell`

**File:** `src/agents/tools/run-shell.tool.ts`

**Params:** `{ "command": "<shell command>", "cwd"?: "<path>" }`

**Description:** Runs a whitelisted shell command (e.g. `npm test`, `git status`). Only enabled
when `SHELL_TOOL_ENABLED=true`. Commands validated against `ALLOWED_COMMANDS` env var (comma-
separated whitelist). Working directory enforced with `sandboxPath()`.

**New dependency:** `execa`

---

## 5. New Environment Variables (proposed)

| Variable | Default | Description |
|----------|---------|-------------|
| `SEMANTIC_CACHE_THRESHOLD` | `0.92` | Cosine similarity threshold for semantic cache |
| `HUMAN_IN_LOOP` | `false` | Enable mid-graph human interrupt checkpoints |
| `CODE_EXECUTION_ENABLED` | `false` | Opt-in for `execute_code` tool |
| `SHELL_TOOL_ENABLED` | `false` | Opt-in for `run_shell` tool |
| `ALLOWED_COMMANDS` | `''` | Comma-separated whitelist for `run_shell` |
| `ALLOWED_URL_PATTERNS` | `''` | Comma-separated regex list for `fetch_url` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `''` | OpenTelemetry collector endpoint (empty = disabled) |
| `LOG_LEVEL` | `info` | Logger verbosity (`debug` / `info` / `warn` / `error`) |

---

## 6. Implementation Priority

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| P0 | Remove `src/core/` + `src/modules/` dead code | S | Reduces confusion |
| P0 | Fix E2E test | S | Unblocks CI reliability |
| P1 | `VALIDATOR` node | M | Reduces wasted iterations |
| P1 | `REFLECTOR` node | M | Improves multi-iteration accuracy |
| P1 | `fetch_url` tool | M | Opens up broad web-reading use cases |
| P1 | Structured logging + Request ID | M | Essential for production debugging |
| P2 | `SUMMARIZER` node | M | Reduces token cost on large results |
| P2 | `append_file` + `delete_file` + `diff_file` tools | S | File workflow completeness |
| P2 | Retry / back-off in `invokeLlm()` | S | Reliability |
| P2 | Enable stricter TypeScript | M | Long-term code health |
| P3 | Semantic cache | L | Improves cache hit rate |
| P3 | `execute_code` tool | L | Powerful but requires careful sandboxing |
| P3 | Parallel tool execution | L | Performance for multi-data prompts |
| P3 | `ROUTER` node / multi-agent handoff | L | Complex orchestration scenarios |
| P3 | Human-in-the-loop checkpoint | L | Interactive agent use cases |
| P3 | OpenTelemetry tracing | L | Production observability |

**Effort key:** S = Small (< 1 day), M = Medium (1–3 days), L = Large (> 3 days)

---

## 7. File Change Summary

### New files to create

```
src/agents/nodes/validator.node.ts
src/agents/nodes/reflector.node.ts
src/agents/nodes/summarizer.node.ts
src/agents/nodes/router.node.ts
src/agents/tools/fetch-url.tool.ts
src/agents/tools/execute-code.tool.ts
src/agents/tools/append-file.tool.ts
src/agents/tools/delete-file.tool.ts
src/agents/tools/diff-file.tool.ts
src/agents/tools/run-shell.tool.ts
test/health.e2e-spec.ts
test/agents.e2e-spec.ts
```

### Files to modify

```
src/agents/graph/agent.graph.ts        # Add new nodes and conditional edges
src/agents/state/agent.state.ts        # Add new state fields + reducers
src/agents/prompts/agent.prompts.ts    # Add buildReflectorPrompt(), update supervisor/planner
src/agents/tools/index.ts             # Register new tools
src/config/env.ts                     # Add new optional env vars
tsconfig.json                         # Enable noImplicitAny: true
```

### Files to delete

```
src/core/                             # Entire directory (dead code)
src/modules/                          # Entire directory (dead code)
test/app.e2e-spec.ts                  # Replace with proper E2E tests
```
