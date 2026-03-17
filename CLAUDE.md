# CLAUDE.md — AI Assistant Reference Guide

This file provides context for AI assistants working on the `nest-langgraph-ai` codebase.

---

## Project Overview

A NestJS API that exposes a multi-agent AI workflow powered by LangGraph. Users submit a natural-language prompt to a REST endpoint. The system is **stateful**, allowing for multi-turn conversations using a session ID. It autonomously routes through a Supervisor → Researcher → Planner → Executor → Critic loop (up to `AGENT_MAX_ITERATIONS` iterations) using an LLM provider and a rich set of tools including web search, file system access, git operations, code search, and LLM-powered analysis.

**Tech stack:** NestJS 11, LangGraph 1.2, LangChain 1.x, Mistral LLM, Tavily Search, Redis (IORedis), Qdrant (vector DB), TypeScript 5.7, Jest 30

---

## Repository Layout

```
src/
├── modules/
│   ├── agents/
│   │   ├── graph/          # LangGraph StateGraph definition
│   │   ├── nodes/          # Five graph nodes: supervisor, researcher, planner, execution, critic
│   │   ├── prompts/        # LLM prompt builders + file-driven templates
│   │   │   ├── agent.prompts.ts   # Template loader, render(), prompt builders
│   │   │   └── templates/         # .txt prompt templates (supervisor, planner, critic)
│   │   ├── state/          # LangGraph annotated state type
│   │   ├── utils/          # Agent-specific utilities (e.g., RedisSaver)
│   │   ├── tools/          # Tool implementations + ToolRegistry
│   │   ├── agents.controller.ts
│   │   ├── agents.service.ts
│   │   ├── agents.dto.ts
│   │   ├── agents.module.ts
│   │   └── tests/          # Unit tests
│   ├── llm/
│   │   ├── llm.provider.ts # LLM provider + invokeLlm()
│   │   └── llm.module.ts
│   ├── redis/
│   │   ├── redis.provider.ts   # IORedis client with lazy connect & retry strategy
│   │   ├── redis.service.ts    # Wrapper service around IORedis
│   │   ├── redis.module.ts     # Global Redis module (OnModuleInit connection check)
│   │   └── redis.constants.ts  # REDIS_CLIENT injection token
│   └── vector-db/
│       ├── vector.service.ts   # Qdrant upsert() + search() wrapper
│       ├── qdrant.provider.ts  # QdrantClient instance factory
│       ├── vector.module.ts    # Vector DB module configuration
│       └── vector.constants.ts # QDRANT_CLIENT injection token
├── common/
│   ├── config/
│   │   └── env.ts          # Joi-validated environment variables
│   ├── dto/
│   │   └── error-response.dto.ts  # Standard error envelope DTO
│   ├── filters/
│   │   └── http-exception.filter.ts  # Global AllExceptionsFilter
│   └── utils/
│       ├── json.util.ts    # Robust JSON extraction from LLM output
│       ├── path.util.ts    # sandboxPath() — enforces AGENT_WORKING_DIR
│       └── pretty-log.util.ts  # Logging helpers (prettyJson, preview, logPhase*)
├── health/
│   ├── health.controller.ts  # GET /health endpoint (checks Redis)
│   └── health.module.ts
├── app.module.ts       # Root module (ConfigModule, Throttler, agents, health, vector-db)
└── main.ts             # Bootstrap (Helmet, compression, CORS, Swagger, validation pipe, global filter)
.github/
└── workflows/
    └── ci.yml          # Build + test on push/PR
docker/
└── docker-compose.yml  # Redis + Redis Commander
```

---

## Development Commands

```bash
# Install dependencies
npm install --legacy-peer-deps

# Start Redis (required)
docker compose -f docker/docker-compose.yml up -d
# OR without Docker:
redis-server --daemonize yes

# Development server (watch mode)
npm run start:dev

# Production build
npm run build
npm run start:prod

# Linting & formatting
npm run lint        # ESLint with auto-fix
npm run format      # Prettier

# Tests
npm run test          # Unit tests
npm run test:watch    # Watch mode
npm run test:cov      # With coverage report
npm run test:e2e      # End-to-end tests
```

---

## Environment Variables

Create a `.env` file at the project root. All variables are validated on startup via Joi (`src/common/config/env.ts`):

| Variable                 | Required | Default                                      | Description                                           |
|--------------------------|----------|----------------------------------------------|-------------------------------------------------------|
| `PORT`                   | No       | `3000`                                       | HTTP server port                                      |
| `MISTRAL_API_KEY`        | Yes      | —                                            | Mistral API key for LLM calls                         |
| `MISTRAL_MODEL`          | No       | `mistral-small-latest`                       | LLM model ID                                          |
| `MISTRAL_TIMEOUT_MS`     | No       | `30000`                                      | LLM call timeout in ms (AbortController)              |
| `TAVILY_API_KEY`         | Yes      | —                                            | Tavily API key for web search                         |
| `REDIS_HOST`             | Yes      | —                                            | Redis server hostname                                 |
| `REDIS_PORT`             | Yes      | —                                            | Redis server port (number)                            |
| `CORS_ORIGIN`            | No       | `*`                                          | Allowed CORS origin                                   |
| `AGENT_MAX_ITERATIONS`   | No       | `3`                                          | Max graph iterations (1–10)                           |
| `TOOL_TIMEOUT_MS`        | No       | `15000`                                      | Per-tool invocation timeout in ms                     |
| `AGENT_MAX_RETRIES`      | No       | `3`                                          | Max consecutive retries on a single step before failing. |
| `AGENT_WORKING_DIR`      | No       | `process.cwd()`                              | Sandbox root for all file tool operations             |
| `CACHE_TTL_SECONDS`      | No       | `60`                                         | Redis cache TTL for agent responses                   |
| `CRITIC_RESULT_MAX_CHARS`| No       | `8000`                                       | Max chars from tool result passed to critic prompt    |
| `PROMPT_MAX_ATTEMPTS`    | No       | `5`                                          | Max recent attempts included in supervisor/planner prompts |
| `PROMPT_MAX_SUMMARY_CHARS` | No     | `2000`                                       | Max chars passed into `llm_summarize` tool            |
| `QDRANT_URL`             | No       | `http://localhost:6333`                      | Qdrant vector database URL                            |
| `QDRANT_COLLECTION`      | No       | `agent_vectors`                              | Qdrant collection name                                |
| `QDRANT_VECTOR_SIZE`          | No       | `384`                     | Embedding vector dimensions (matches free local embeddings)        |
| `SPLUNK_URL`                  | No       | `http://localhost:8089`   | Splunk REST API base URL                                           |
| `SPLUNK_TOKEN`                | No       | —                         | Splunk Bearer token for authentication                             |
| `SPLUNK_DEFAULT_INDEX`        | No       | `main`                    | Default Splunk index for log tools                                 |
| `SPLUNK_POLL_INTERVAL_MS`     | No       | `1500`                    | Polling interval when waiting for a Splunk search job to complete  |
| `SPLUNK_POLL_MAX_ATTEMPTS`    | No       | `20`                      | Max polling attempts before giving up on a Splunk job              |

Missing required variables cause an immediate startup crash with a descriptive error.

The `env` object exported from `src/common/config/env.ts` maps these to camelCase properties (e.g., `MISTRAL_API_KEY` → `env.mistralKey`).

---

## Agent Graph Architecture

The core workflow is a **phase-driven LangGraph StateGraph** (`src/modules/agents/graph/agent.graph.ts`).

High-level:

```
START → SUPERVISOR → ROUTER → RESEARCHER → ROUTER → PLANNER → ROUTER → PLAN_VALIDATOR → ROUTER → EXECUTE → ROUTER → TOOL_RESULT_NORMALIZER → ROUTER → CRITIC → ROUTER → END

Additional routing:
- ROUTER → JSON_REPAIR (when an LLM response fails JSON/Zod validation)
- ROUTER enforces global hard stop limits (turns/toolCalls/replans/stepRetries)
```

| Node       | File                                   | Responsibility                                                              |
|------------|----------------------------------------|-----------------------------------------------------------------------------|
| SUPERVISOR | `nodes/supervisor.node.ts`             | Feasibility + normalize objective (strict Zod JSON)                         |
| RESEARCHER | `nodes/researcher.node.ts`             | Gathers project context (file tree, git status) — no LLM call               |
| PLANNER    | `nodes/planner.node.ts`                | Creates multi-step plan (strict Zod JSON)                                   |
| PLAN_VALIDATOR | `nodes/plan-validator.node.ts`     | Validates step ids/tools/tool params against tool schemas                   |
| EXECUTE    | `nodes/execution.node.ts`              | Invokes the selected tool; substitutes `__PREVIOUS_RESULT__` from `toolResultRaw` |
| TOOL_RESULT_NORMALIZER | `nodes/tool-result-normalizer.node.ts` | Wraps raw tool output into a structured `ToolResult` envelope        |
| CRITIC     | `nodes/critic.node.ts`                 | Decides advance/retry/replan/complete/fatal (strict Zod JSON)               |
| ROUTER     | `nodes/decision-router.node.ts`        | Phase-driven routing + deadlock protection limits                           |
| JSON_REPAIR| `nodes/json-repair.node.ts`            | Repairs invalid LLM JSON to match the required schema                       |

### Node/prompt special instructions (important)

These are behavioral rules that the prompts should follow to keep runs reliable and “memory-aware”:

- **RESEARCHER**: gather only deterministic context (tree/git). If the user prompt suggests prior knowledge may matter (e.g. “as we decided earlier”, “remember”, “what did we choose”), the plan should include an early `vector_search` step to recall relevant memories.
- **PLANNER**: prefer `vector_search` before making irreversible decisions; prefer `vector_upsert` after successful tool results to store durable facts/decisions/summaries. Keep stored text short and retrieval-oriented.
- **PLAN_VALIDATOR**: treat `QDRANT_VECTOR_SIZE` mismatch as fatal at runtime (embedding service will throw); plans that depend on vector memory should include a mitigation step if Qdrant is unavailable.
- **CRITIC**: if results show a recalled memory is irrelevant/low-confidence, request a follow-up `vector_search` with a refined query rather than hallucinating.

### LLM calls

All node LLM calls go through `invokeLlm()` from `src/modules/llm/llm.provider.ts`:
```typescript
invokeLlm(prompt: string, timeoutMs?: number): Promise<string>
```
This wraps `ChatMistralAI` with an AbortController timeout (default `MISTRAL_TIMEOUT_MS`). **Never call `llm.invoke()` directly.**

### Agent flow

1. **Supervisor** → outputs `{status:'ok'|'reject', objective?...}` (Zod)\n2. **Researcher** → gathers project context\n3. **Planner** → outputs `{objective, steps[], expected_result}` (Zod)\n4. **PlanValidator** → validates tools + params\n5. **Executor** → runs tools, writes `toolResultRaw`\n6. **ToolResultNormalizer** → wraps to `ToolResult`\n7. **Critic** → outputs `{decision:'advance'|'retry_step'|'replan'|'complete'|'fatal', ...}` (Zod)\n8. **Router** → updates state, enforces limits, terminates on `complete|fatal`

### Prompt templates

Prompts are file-driven (`.txt` files in `src/modules/agents/prompts/templates/`):
- `supervisor.txt` — feasibility evaluation
- `planner.txt` — multi-step plan creation (includes project context from researcher)
- `critic.txt` — step evaluation and decision

Templates use `{{variable}}` placeholders rendered by `render()` in `agent.prompts.ts`. The `nest-cli.json` is configured with `watchAssets: true` so `.txt` files are copied to `dist/` during build.

### State shape (`src/modules/agents/state/agent.state.ts`)

```typescript
{
  input: string;
  phase: AgentPhase;             // single driver of routing
  objective?: string;
  plan: PlanStep[];
  currentStep: number;
  expectedResult?: string;
  selectedTool?: string;
  toolParams?: Record<string, unknown>;
  toolResultRaw?: string;        // raw tool output
  toolResult?: ToolResult;       // normalized envelope for critic/router
  projectContext?: string;
  finalAnswer?: string;
  counters: { turn; toolCalls; replans; stepRetries };
  errors: AgentError[];
  jsonRepair?: { fromPhase; raw; schema };
  jsonRepairResult?: string;
  criticDecision?: { decision; reason; finalAnswer?; suggestedPlanFix? };
  attempts: Attempt[];           // bounded structured attempt history
}

interface PlanStep {
  step_id: number;
  description: string;
  tool: string;
  input: Record<string, unknown>;
}
```

Graph state mutations must go through annotated reducers — **never mutate state directly**.

---

## Available Tools

All tools are defined in `src/modules/agents/tools/`. Inputs validated with **Zod**. File tools enforce `AGENT_WORKING_DIR` via `sandboxPath()`.

| Tool Name        | File                    | Params                                                          | Description                                       |
|------------------|-------------------------|-----------------------------------------------------------------|---------------------------------------------------|
| `search`         | `search.tool.ts`        | `{"query":"<string>"}`                                          | Web search via Tavily (up to 5 results)           |
| `read_file`      | `read-file.tool.ts`     | `{"path":"<path>"}`                                             | Reads a local file (truncated at 100 KB)          |
| `write_file`     | `write-file.tool.ts`    | `{"path":"<path>","content":"<text>"}`                          | Writes content to a file (creates parent dirs)    |
| `list_dir`       | `list-dir.tool.ts`      | `{"path":"<path>"}`                                             | Lists directory contents with type and size info  |
| `tree_dir`       | `tree-dir.tool.ts`      | `{"path":"<path>"}`                                             | Recursive directory tree (skips node_modules, .git, dist, coverage) |
| `llm_summarize`  | `llm-summarize.tool.ts` | `{"content":"<text>","instruction":"<what>"}`                   | AI-powered content summarization/analysis         |
| `git_info`       | `git-info.tool.ts`      | `{"action":"status\|log\|diff\|branch\|show"}`                  | Query git repository information (whitelisted)    |
| `grep_search`    | `grep-search.tool.ts`   | `{"pattern":"<regex>","path":"<dir>","glob":"<filter>"}`        | Search for patterns across files                  |
| `file_patch`     | `file-patch.tool.ts`    | `{"path":"<file>","find":"<text>","replace":"<text>"}`          | Find and replace within a file (single occurrence)|
| `generate_mermaid`  | `generate-mermaid.tool.ts`  | `{"description":"<diagram instructions>","source?":"<authoritative text>","path":"<output .mmd path>"}` | Generate a Mermaid (.mmd) diagram and save to file |
| `read_mermaid`      | `read-mermaid.tool.ts`      | `{"path":"<.mmd file path>"}`                                         | Read a Mermaid (.mmd) file |
| `edit_mermaid`      | `edit-mermaid.tool.ts`      | `{"path":"<.mmd file path>","instruction":"<how to change>"}`         | Edit a Mermaid (.mmd) file based on instruction |
| `analyze_logs`      | `analyze-logs.tool.ts`      | `{"spl":"<SPL>","index":"<idx>","earliest_time":"-1h","focus":"<question>"}` | Query Splunk logs and return AI-powered analysis |
| `detect_root_cause` | `detect-root-cause.tool.ts` | `{"service":"<svc>","earliest_time":"-1h","pattern":"<keyword>"}` | Search Splunk for errors and produce a structured RCA report |
| `suggest_fix`       | `suggest-fix.tool.ts`       | `{"root_cause":"<text>","service":"<svc>","tech_stack":"<e.g. TypeScript/NestJS>","validate_with_splunk":false}` | Generate immediate mitigation + permanent fix plan |
| `ast_parse`        | `ast-parse.tool.ts`        | `{"path":"<JS/TS file>","maxChunks":10}`                                       | Parse JS/TS to semantic AST chunks (functions/classes/vars) |
| `system_info`    | `system-info.tool.ts`   | `{}`                                                            | Get information about the current system environment (OS, CPU, memory, uptime). |
| `http_get`       | `http-get.tool.ts`      | `{"url":"<valid http url>"}`                                    | Perform an HTTP GET request to a specific URL and return the response body (JSON or text). |
| `http_post`      | `http-post.tool.ts`     | `{"url":"<url>","body":"<json string>"}`                        | Perform an HTTP POST request to a URL with a JSON body. |
| `glob_files`     | `glob-files.tool.ts`    | `{"root?":"<dir>","extensions?":[".ts"],"maxResults?":200}`      | Safe recursive file listing (bounded)             |
| `read_files_batch` | `read-files-batch.tool.ts` | `{"paths":["a","b"]}`                                        | Read multiple files in one call (bounded)         |
| `stat_path`      | `stat-path.tool.ts`     | `{"path":"<path>"}`                                             | File metadata (exists/type/size/mtime)            |
| `vector_upsert`  | `vector-upsert.tool.ts`  | `{"text":"<text>","id?":"<optional id>","metadata?":{...}}`      | Embed text locally and upsert into Qdrant memory  |
| `vector_search`  | `vector-search.tool.ts`  | `{"query":"<query>","topK?":5}`                                 | Embed query locally and search Qdrant memory      |

Splunk tools share a common client in `tools/splunk.client.ts` (`splunkSearch()` + `formatEvents()`).


The **ToolRegistry** (`tools/tool.registry.ts`) exposes:
- `get(name)` — lookup by name
- `has(name)` — check existence
- `getNames()` — all registered tool names
- `getToolsWithParams()` — formatted string for prompts including param schemas

The supervisor and planner prompts automatically filter out previously errored tools via `getAvailableTools()` in `agent.prompts.ts`.

---

## Supporting Modules

### Redis (`src/modules/redis/`)

- **`redis.provider.ts`** — creates an IORedis client with lazy connect and exponential-backoff retry strategy
- **`redis.service.ts`** — thin wrapper service; injected via `REDIS_CLIENT` token
- **`redis.module.ts`** — global module; verifies connection on `OnModuleInit`
- **`redis.constants.ts`** — exports `REDIS_CLIENT` injection token

### Vector DB (`src/modules/vector-db/`)

Qdrant integration for semantic vector storage.

This repo uses **free local embeddings** via `@xenova/transformers` (`Xenova/all-MiniLM-L6-v2`, 384 dims). The first embedding call may download model assets.

- **`qdrant.provider.ts`** — creates a `QdrantClient` pointed at `env.qdrantUrl`
- **`vector.service.ts`** — `upsert(id, vector, metadata)` and `search(queryVector, topK)` methods
- **`vector.module.ts`** — wires provider and service; exported for other modules to import
- **`vector.constants.ts`** — exports `QDRANT_CLIENT` injection token
- **`embedding.service.ts`** — local on-device text → embedding vectors (must match `QDRANT_VECTOR_SIZE`)

---

## API

**Base URL:** `http://localhost:3000/api`

**Swagger docs:** `http://localhost:3000/docs`

### POST `/agents/run`

Runs the agent loop. For new conversations, it returns a `sessionId`. For existing conversations, provide the `sessionId` to continue from the previous state.

```json
// Request
{
  "prompt": "What is the current price of Bitcoin?",
  "sessionId": "optional-session-id-to-continue-conversation"
}

// Response 200
{
  "result": "The current price of Bitcoin is approximately $X...",
  "sessionId": "a1b2c3d4-e5f6-7890-1234-567890abcdef"
}

// Response 500
{ "statusCode": 500, "timestamp": "...", "path": "/api/agents/run", "message": "..." }
```

### POST `/agents/stream`

Streams agent execution as Server-Sent Events. Each event is `data: {"node":"<name>","data":{…}}`.

### GET `/health`

Returns service health including Redis connectivity.

```json
{ "status": "ok", "redis": "ok", "timestamp": "2024-01-01T00:00:00.000Z" }
```

Rate limit: **60 requests per 60 seconds** (global ThrottlerModule).

---

## Redis Caching

`AgentsService.run()` checks a SHA256-keyed Redis cache before invoking the graph. Cache key format: `agent:cache:<sha256(prompt)>`. TTL is `CACHE_TTL_SECONDS`. Redis errors are caught and logged; the agent still runs if Redis is unavailable.

---

## Error Handling

- `AllExceptionsFilter` (`src/common/filters/http-exception.filter.ts`) is registered globally in `main.ts`
- All errors return `ErrorResponseDto`: `{ statusCode, timestamp, path, message }`
- Tool execution failures are captured in `toolResultRaw` then normalized into `toolResult.ok=false`
- The SUPERVISOR skips errored tools on subsequent iterations via `getAvailableTools()`

---

## Logging

All graph nodes use structured logging with visual flow markers:
- `logPhaseStart(phase, detail)` — separator + node entry
- `logPhaseEnd(phase, outcome, durationMs)` — node completion with timing
- `startTimer()` — returns elapsed-time function for node timing
- Service-level logs show full run summary with step count and total time

Utilities in `src/common/utils/pretty-log.util.ts`.

---

## LLM Provider

Configured in `src/modules/llm/llm.provider.ts`:
- **Model:** `MISTRAL_MODEL` env var (default: `mistral-small-latest`)
- **Temperature:** `0` (deterministic output)
- **Timeout:** `MISTRAL_TIMEOUT_MS` ms via AbortController

---

## TypeScript Path Aliases

Defined in `tsconfig.json` and mirrored in Jest's `moduleNameMapper`:

| Alias          | Resolves to                         |
|----------------|-------------------------------------|
| `@agents/*`    | `src/modules/agents/*`              |
| `@nodes/*`     | `src/modules/agents/nodes/*`        |
| `@state/*`     | `src/modules/agents/state/*`        |
| `@graph/*`     | `src/modules/agents/graph/*`        |
| `@tools/*`     | `src/modules/agents/tools/*`        |
| `@config/*`    | `src/common/config/*`               |
| `@utils/*`     | `src/common/utils/*`                |
| `@common/*`    | `src/common/*`                      |
| `@llm/*`       | `src/modules/llm/*`                 |
| `@redis/*`     | `src/modules/redis/*`               |
| `@vector-db/*` | `src/modules/vector-db/*`           |
| `@health/*`    | `src/modules/health/*`              |

Always use these aliases in imports rather than long relative paths.

---

## Code Conventions

### General
- **TypeScript is partially strict**: `strictNullChecks: true` is on, but `noImplicitAny: false` and `strictBindCallApply: false` — avoid `any` regardless (ESLint warns on unsafe operations)
- Use `interface` for object shapes and `type` for unions/aliases
- Prefer `async/await` over raw promises
- Keep node functions pure where possible; side effects belong in providers

### NestJS patterns
- Inject dependencies via constructor DI; no service locator pattern
- DTOs live in `agents.dto.ts` and use `class-validator` decorators
- Swagger annotations (`@ApiProperty`, `@ApiOperation`, `@ApiResponse`) required on all DTOs and controller methods
- Use `ErrorResponseDto` as the `type` for `@ApiResponse` on 4xx/5xx responses

### LLM / LangGraph
- All LLM calls go through `invokeLlm()` — never call `llm.invoke()` directly
- All LLM responses are parsed through `extractJson()` from `@utils/json.util.ts`
- Prompt builders live in `src/modules/agents/prompts/agent.prompts.ts`; keep business logic out of prompts
- Prompt templates are `.txt` files in `src/modules/agents/prompts/templates/`
- Graph state mutations must go through annotated reducers — never mutate state directly

### File safety
- All file tool operations must use `sandboxPath()` from `@utils/path.util.ts`
- `sandboxPath()` enforces `AGENT_WORKING_DIR` and throws if the resolved path escapes the sandbox

### Testing
- Unit tests go in `src/modules/agents/tests/*.spec.ts`
- Mock external dependencies (LLM, Redis, tools) with Jest mocks
- E2E tests go in `test/`
- Run `npm run test:cov` and aim to maintain coverage; coverage report goes to `../coverage`

---

## Adding a New Tool

1. Create `src/modules/agents/tools/<name>.tool.ts` exporting a `DynamicStructuredTool` or using `tool()`
2. Define the Zod input schema inline; use `sandboxPath()` for any file path handling
3. Register it in `src/modules/agents/tools/index.ts` with a param hint string
4. The `ToolRegistry` picks it up automatically — no further wiring needed

---

## Adding a New Graph Node

1. Create `src/modules/agents/nodes/<name>.node.ts` exporting an async function `(state: AgentState) => Partial<AgentState>`
2. Add the node and any new edges in `src/modules/agents/graph/agent.graph.ts`
3. Extend `AgentState` in `src/modules/agents/state/agent.state.ts` if new fields are required (add reducers where needed)
4. If the node uses an LLM, create a `.txt` template in `prompts/templates/` and a builder in `agent.prompts.ts`

---

## CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`):
- Triggers: push/PR to `main`
- Node.js 20 on Ubuntu
- Steps: checkout, npm ci --legacy-peer-deps, npm run build, npm test --coverage
- Coverage uploaded to Codecov
- No secrets required for tests

Repo: https://github.com/matanbardugo/nest-langgraph-ai/actions

---

## Release Process

This project uses `standard-version` for semantic versioning:

```bash
npm run release          # auto-bumps based on conventional commits
npm run release -- --release-as minor   # force minor bump
```

Commit messages must follow **Conventional Commits** (`feat:`, `fix:`, `refactor:`, `perf:`, `chore:`, etc.) for the changelog to generate correctly.
