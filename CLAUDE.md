# CLAUDE.md — AI Assistant Reference Guide

This file provides context for AI assistants working on the `nest-langgraph-ai` codebase.

---

## Project Overview

A NestJS API that exposes a multi-agent AI workflow powered by LangGraph. Users submit a natural-language prompt to a REST endpoint; the system autonomously routes through a Supervisor → Researcher → Planner → Executor → Critic loop (up to `AGENT_MAX_ITERATIONS` iterations) using Groq's Llama 4 Scout model and a rich set of tools including web search, file system access, git operations, code search, and LLM-powered analysis.

**Tech stack:** NestJS 11, LangGraph 1.2, LangChain 1.x, Groq LLM, Tavily Search, Redis (IORedis), TypeScript 5.7, Jest 30

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
│   │   ├── tools/          # Tool implementations + ToolRegistry
│   │   ├── agents.controller.ts
│   │   ├── agents.service.ts
│   │   ├── agents.dto.ts
│   │   ├── agents.module.ts
│   │   └── tests/          # Unit tests
│   └── llm/
│       ├── llm.provider.ts # LLM (Groq) provider + invokeLlm()
│       └── llm.module.ts
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
│   ├── health.controller.ts  # GET /health endpoint
│   └── health.module.ts
├── app.module.ts       # Root module
└── main.ts             # Bootstrap (Helmet, CORS, Swagger, validation pipe, global filter)
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

| Variable                | Required | Default             | Description                                         |
|-------------------------|----------|---------------------|-----------------------------------------------------|
| `PORT`                  | No       | `3000`              | HTTP server port                                    |
| `GROQ_API_KEY`          | Yes      | —                   | Groq API key for LLM calls                          |
| `TAVILY_API_KEY`        | Yes      | —                   | Tavily API key for web search                       |
| `REDIS_HOST`            | Yes      | —                   | Redis server hostname                               |
| `REDIS_PORT`            | Yes      | —                   | Redis server port (number)                          |
| `CORS_ORIGIN`           | No       | `*`                 | Allowed CORS origin                                 |
| `GROQ_MODEL`            | No       | `meta-llama/llama-4-scout-17b-16e-instruct` | Groq model ID |
| `GROQ_TIMEOUT_MS`       | No       | `30000`             | LLM call timeout in ms (AbortController)            |
| `AGENT_MAX_ITERATIONS`  | No       | `3`                 | Max graph iterations (1–10)                         |
| `TOOL_TIMEOUT_MS`       | No       | `15000`             | Per-tool invocation timeout in ms                   |
| `AGENT_WORKING_DIR`     | No       | `process.cwd()`     | Sandbox root for all file tool operations           |
| `CACHE_TTL_SECONDS`     | No       | `60`                | Redis cache TTL for agent responses                 |
| `CRITIC_RESULT_MAX_CHARS`| No      | `8000`              | Max chars from tool result passed to critic prompt  |
| `PROMPT_MAX_ATTEMPTS`   | No       | `5`                 | Max recent attempts included in supervisor/planner prompts |

Missing required variables cause an immediate startup crash with a descriptive error.

---

## Agent Graph Architecture

The core workflow is a **LangGraph StateGraph** (`src/modules/agents/graph/agent.graph.ts`):

```
START → SUPERVISOR → RESEARCHER → PLANNER → EXECUTE → CRITIC
              ↑                      ↑                    |
              |                      └────────────────────┘  (next step in plan)
              └───────────────────────────────────────────┘  (retry / re-plan)
                                                          → END (complete / error / max iterations)
```

| Node       | File                              | Responsibility                                                              |
|------------|-----------------------------------|-----------------------------------------------------------------------------|
| SUPERVISOR | `nodes/supervisor.node.ts`        | Evaluates feasibility; outputs `{status, task}` JSON                        |
| RESEARCHER | `nodes/researcher.node.ts`        | Gathers project context (file tree, git status) — no LLM call              |
| PLANNER    | `nodes/planner.node.ts`           | Creates multi-step execution plan; outputs `{objective, steps[], expected_result}` |
| EXECUTE    | `nodes/execution.node.ts`         | Invokes the selected tool with `toolParams`; substitutes `__PREVIOUS_RESULT__` |
| CRITIC     | `nodes/critic.node.ts`            | Evaluates result; advances plan or sets `done=true` + `finalAnswer`         |

### LLM calls

All node LLM calls go through `invokeLlm()` from `src/modules/llm/llm.provider.ts`:
```typescript
invokeLlm(prompt: string, timeoutMs?: number): Promise<string>
```
This wraps ChatGroq with an AbortController timeout (default `GROQ_TIMEOUT_MS`).

### Agent flow

1. **Supervisor** → evaluates task feasibility, outputs `{"status":"plan_required","task":"..."}`
2. **Researcher** → gathers project context (file tree + git status) automatically
3. **Planner** → creates multi-step plan with project context: `{"objective":"...","steps":[...],"expected_result":"..."}`
4. **Executor** → runs each step's tool, substituting `__PREVIOUS_RESULT__` between steps
5. **Critic** → evaluates each step result; advances to next step, retries, or completes

### Prompt templates

Prompts are file-driven (`.txt` files in `src/modules/agents/prompts/templates/`):
- `supervisor.txt` — feasibility evaluation
- `planner.txt` — multi-step plan creation (includes project context from researcher)
- `critic.txt` — step evaluation and decision

Templates use `{{variable}}` placeholders rendered by `agent.prompts.ts`.

### State shape (`src/modules/agents/state/agent.state.ts`)

```typescript
{
  input: string;
  plan: PlanStep[];              // multi-step execution plan
  currentStep: number;           // 0-based index into plan
  status: string;                // idle | plan_required | running | complete | retry | error
  expectedResult: string;        // success criteria from planner
  selectedTool: string;
  toolInput: string;             // JSON string of params (display only)
  toolParams: Record<string, unknown>;  // structured params for tool.invoke()
  toolResult: string;
  projectContext: string;        // file tree + git status from researcher
  executionPlan: string;         // cleaned objective
  finalAnswer: string;
  done: boolean;
  iteration: number;
  lastToolErrored: boolean;
  attempts: Attempt[];           // reducer: appends each attempt
}

interface PlanStep {
  step_id: number;
  description: string;
  tool: string;
  input: Record<string, unknown>;
}
```

---

## Available Tools

All tools are defined in `src/modules/agents/tools/`. Inputs validated with **Zod**. File tools enforce `AGENT_WORKING_DIR` via `sandboxPath()`.

| Tool Name        | File                   | Params                                          | Description                                       |
|------------------|------------------------|-------------------------------------------------|---------------------------------------------------|
| `search`         | `search.tool.ts`       | `{"query":"<string>"}`                          | Web search via Tavily (up to 5 results)           |
| `read_file`      | `read-file.tool.ts`    | `{"path":"<path>"}`                             | Reads a local file (truncated at 100 KB)          |
| `write_file`     | `write-file.tool.ts`   | `{"path":"<path>","content":"<text>"}`           | Writes content to a file (creates parent dirs)    |
| `list_dir`       | `list-dir.tool.ts`     | `{"path":"<path>"}`                             | Lists directory contents with type and size info  |
| `tree_dir`       | `tree-dir.tool.ts`     | `{"path":"<path>"}`                             | Recursive directory tree (like Unix `tree`)       |
| `shell_run`      | `shell-run.tool.ts`    | `{"command":"<cmd>"}`                           | Execute shell command; returns clean stdout       |
| `llm_summarize`  | `llm-summarize.tool.ts`| `{"content":"<text>","instruction":"<what>"}`    | AI-powered content summarization/analysis         |
| `git_info`       | `git-info.tool.ts`     | `{"action":"status\|log\|diff\|branch\|show"}`  | Query git repository information                  |
| `grep_search`    | `grep-search.tool.ts`  | `{"pattern":"<regex>","path":"<dir>","glob":"<filter>"}` | Search for patterns across files        |
| `file_patch`     | `file-patch.tool.ts`   | `{"path":"<file>","find":"<text>","replace":"<text>"}` | Find and replace within a file            |

The **ToolRegistry** (`tools/tool.registry.ts`) exposes:
- `get(name)` — lookup by name
- `has(name)` — check existence
- `getNames()` — all registered tool names
- `getToolsWithParams()` — formatted string for prompts including param schemas

---

## API

**Base URL:** `http://localhost:3000/api`

**Swagger docs:** `http://localhost:3000/docs`

### POST `/agents/run`

Runs the full agent loop and returns the final answer.

```json
// Request
{ "prompt": "What is the current price of Bitcoin?" }

// Response 200
{ "result": "The current price of Bitcoin is approximately $X..." }

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
- Node functions catch tool errors and set `lastToolErrored: true` on state
- The SUPERVISOR skips errored tools on subsequent iterations

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
- **Model:** `GROQ_MODEL` env var (default: `meta-llama/llama-4-scout-17b-16e-instruct`)
- **Temperature:** `0` (deterministic output)
- **Timeout:** `GROQ_TIMEOUT_MS` ms via AbortController

---

## TypeScript Path Aliases

Defined in `tsconfig.json` and mirrored in Jest's `moduleNameMapper`:

| Alias          | Resolves to                    |
|----------------|--------------------------------|
| `@config/*`    | `src/common/config/*`          |
| `@utils/*`     | `src/common/utils/*`           |
| `@llm/*`       | `src/modules/llm/*`            |
| `@redis/*`     | `src/modules/redis/*`          |
| `@modules/*`   | `src/modules/*`                |

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

GitHub Actions runs on every push and pull request (`.github/workflows/ci.yml`):
1. `npm ci --legacy-peer-deps`
2. `npm run build`
3. `npm test -- --passWithNoTests`

---

## Release Process

This project uses `standard-version` for semantic versioning:

```bash
npm run release          # auto-bumps based on conventional commits
npm run release -- --release-as minor   # force minor bump
```

Commit messages must follow **Conventional Commits** (`feat:`, `fix:`, `refactor:`, `perf:`, `chore:`, etc.) for the changelog to generate correctly.
