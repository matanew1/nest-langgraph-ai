# CLAUDE.md — AI Assistant Reference Guide

This file provides context for AI assistants working on the `nest-langgraph-ai` codebase.

---

## Project Overview

A NestJS API that exposes a multi-agent AI workflow powered by LangGraph. Users submit a natural-language prompt to a single REST endpoint; the system autonomously routes through a Supervisor → Planner → Executor → Critic loop (up to 3 iterations) using Groq's Llama 4 Scout model and tools like web search and file system access.

**Tech stack:** NestJS 11, LangGraph 1.2, LangChain 1.x, Groq LLM, Tavily Search, Redis (IORedis), TypeScript 5.7, Jest 30

---

## Repository Layout

```
src/
├── agents/
│   ├── graph/          # LangGraph StateGraph definition
│   ├── module/         # NestJS controller, service, DTOs, unit tests
│   ├── nodes/          # Four graph nodes: supervisor, planner, execution, critic
│   ├── prompts/        # LLM prompt builders
│   ├── providers/      # LLM (Groq) and Redis provider factories
│   ├── state/          # LangGraph annotated state type
│   └── tools/          # Tool implementations + ToolRegistry
├── config/
│   └── env.ts          # Joi-validated environment variables
├── utils/
│   └── json.util.ts    # Robust JSON extraction from LLM output
├── app.module.ts       # Root module
└── main.ts             # Bootstrap (Helmet, CORS, Swagger, validation pipe)
test/                   # E2E tests (Jest)
docker/
└── docker-compose.yml  # Redis + Redis Commander
```

---

## Development Commands

```bash
# Install dependencies
npm install

# Start Redis (required)
docker compose -f docker/docker-compose.yml up -d

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

# Versioning
npm run release       # Bumps version + updates CHANGELOG.md
```

---

## Environment Variables

Create a `.env` file at the project root. All variables are validated on startup via Joi (`src/config/env.ts`):

| Variable        | Required | Default | Description                         |
|-----------------|----------|---------|-------------------------------------|
| `PORT`          | No       | `3000`  | HTTP server port                    |
| `GROQ_API_KEY`  | Yes      | —       | Groq API key for LLM calls          |
| `TAVILY_API_KEY`| Yes      | —       | Tavily API key for web search       |
| `REDIS_HOST`    | Yes      | —       | Redis server hostname               |
| `REDIS_PORT`    | Yes      | —       | Redis server port (number)          |
| `CORS_ORIGIN`   | No       | `*`     | Allowed CORS origin                 |

Missing required variables cause an immediate startup crash with a descriptive error.

---

## Agent Graph Architecture

The core workflow is a **LangGraph StateGraph** (`src/agents/graph/agent.graph.ts`) with these nodes:

```
SUPERVISOR → PLANNER → EXECUTE → CRITIC
    ↑___________________________|  (if not done and iterations < 3)
```

| Node       | File                              | Responsibility                                                       |
|------------|-----------------------------------|----------------------------------------------------------------------|
| SUPERVISOR | `nodes/supervisor.node.ts`        | Picks the best tool for the user's input; skips previously-errored tools |
| PLANNER    | `nodes/planner.node.ts`           | Refines the query and defines a success criterion                    |
| EXECUTE    | `nodes/execution.node.ts`         | Invokes the selected tool; sets `lastToolErrored` on failure         |
| CRITIC     | `nodes/critic.node.ts`            | Evaluates the result; sets `done=true` + `finalAnswer` if satisfied  |

**State shape** (`src/agents/state/agent.state.ts`):

```typescript
{
  input: string;
  selectedTool: string;
  toolInput: string;
  toolParams: Record<string, unknown>;
  toolResult: string;
  executionPlan: string;
  steps: string[];
  currentStep: string;
  finalAnswer: string;
  done: boolean;
  iteration: number;
  attempts: string[];         // reducer: appends each attempt
  lastToolErrored: boolean;
}
```

---

## Available Tools

Defined in `src/agents/tools/`. All inputs validated with **Zod**.

| Tool Name    | File               | Description                                        |
|--------------|--------------------|----------------------------------------------------|
| `search`     | `search.tool.ts`   | Web search via Tavily (returns up to 5 results)    |
| `read_file`  | `read-file.tool.ts`| Reads a local file (truncated at 100 KB)           |
| `write_file` | `write-file.tool.ts`| Writes content to a file (creates parent dirs)    |
| `list_dir`   | `list-dir.tool.ts` | Lists directory contents with type and size info   |

The **ToolRegistry** (`tools/tool.registry.ts`) exposes:
- `getTools()` — all registered tools
- `getTool(name)` — lookup by name
- `executeTool(name, params)` — run a tool with Zod-validated params

---

## API

**Base URL:** `http://localhost:3000/api`

**Swagger docs:** `http://localhost:3000/docs`

### POST `/agents/run`

```json
// Request
{ "prompt": "What is the current price of Bitcoin?" }

// Response
{ "result": "The current price of Bitcoin is approximately $X..." }
```

Rate limit: **60 requests per 60 seconds** (global ThrottlerModule).

---

## LLM Provider

Configured in `src/agents/providers/llm.provider.ts`:
- **Model:** `meta-llama/llama-4-scout-17b-16e-instruct` via ChatGroq
- **Temperature:** `0` (deterministic output)
- To change models, update `LLM_MODEL` in that file or make it an env variable.

---

## TypeScript Path Aliases

Defined in `tsconfig.json` and mirrored in Jest's `moduleNameMapper`:

| Alias          | Resolves to                    |
|----------------|--------------------------------|
| `@agents/*`    | `src/agents/*`                 |
| `@config/*`    | `src/config/*`                 |
| `@utils/*`     | `src/utils/*`                  |
| `@nodes/*`     | `src/agents/nodes/*`           |
| `@providers/*` | `src/agents/providers/*`       |
| `@state/*`     | `src/agents/state/*`           |
| `@graph/*`     | `src/agents/graph/*`           |
| `@module/*`    | `src/agents/module/*`          |
| `@tools/*`     | `src/agents/tools/*`           |

Always use these aliases in imports rather than long relative paths.

---

## Code Conventions

### General
- **TypeScript strict mode** is enabled; avoid `any` (ESLint warns on unsafe operations)
- Use `interface` for object shapes and `type` for unions/aliases
- Prefer `async/await` over raw promises
- Keep node functions pure where possible; side effects belong in providers

### NestJS patterns
- Inject dependencies via constructor DI; no service locator pattern
- DTOs live in `agents.dto.ts` and use `class-validator` decorators
- Swagger annotations (`@ApiProperty`, `@ApiOperation`) are required on all DTOs and controller methods

### LLM / LangGraph
- All LLM calls return raw strings; always parse through `extractJson()` from `@utils/json.util.ts`
- Prompt builders live in `src/agents/prompts/agent.prompts.ts`; keep business logic out of prompts
- Graph state mutations must go through annotated reducers — never mutate state directly

### Error handling
- Node functions should catch tool errors and set `lastToolErrored: true` on state
- The SUPERVISOR skips errored tools using `lastToolErrored` on the next iteration

### Testing
- Unit tests go in `src/agents/module/tests/*.spec.ts`
- Mock external dependencies (LLM, Redis, tools) with Jest mocks
- E2E tests go in `test/`
- Run `npm run test:cov` and aim to maintain coverage; coverage report goes to `../coverage`

### Linting / Formatting
- ESLint flat config (`eslint.config.mjs`) with TypeScript type-aware rules
- Prettier: single quotes, trailing commas (`all`)
- Run `npm run lint` before committing; CI will fail on lint errors

---

## Adding a New Tool

1. Create `src/agents/tools/<name>.tool.ts` exporting a `DynamicStructuredTool`
2. Define the Zod input schema inline
3. Register it in `src/agents/tools/index.ts` (import and add to the exported array)
4. The `ToolRegistry` picks it up automatically — no further wiring needed
5. Update the SUPERVISOR prompt in `agent.prompts.ts` to describe the new tool

---

## Adding a New Graph Node

1. Create `src/agents/nodes/<name>.node.ts` exporting an async function `(state: AgentState) => Partial<AgentState>`
2. Add the node and any new edges in `src/agents/graph/agent.graph.ts`
3. Extend `AgentState` in `src/agents/state/agent.state.ts` if new fields are required (add reducers where needed)

---

## Redis Usage

Redis is used for LangGraph checkpoint/state persistence (via the `redis.provider.ts` IORedis instance). The Docker Compose file spins up Redis on `6379` and Redis Commander (GUI) on `8081`.

---

## Release Process

This project uses `standard-version` for semantic versioning:

```bash
npm run release          # auto-bumps based on conventional commits
npm run release -- --release-as minor   # force minor bump
```

Commit messages must follow **Conventional Commits** (`feat:`, `fix:`, `refactor:`, `perf:`, `chore:`, etc.) for the changelog to generate correctly.
