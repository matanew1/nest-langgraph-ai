# nest-langgraph-ai [![CI](https://github.com/matanbardugo/nest-langgraph-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/matanbardugo/nest-langgraph-ai/actions/workflows/ci.yml)

A NestJS API that exposes an autonomous multi-agent AI workflow powered by LangGraph. Submit a natural-language prompt and the system autonomously plans, executes, and validates tasks using an LLM-backed agent loop and a rich toolset.

**CI/CD:** GitHub Actions (build, test, coverage)

## Architecture

```
User Prompt
     |
     v
+-----------+
| SUPERVISOR |  Evaluates task feasibility
+-----+-----+
      v
+-----------+
| RESEARCHER |  Gathers project context (file tree, git status)
+-----+-----+
      v
+-----------+
|  PLANNER   |  Creates multi-step execution plan
+-----+-----+
      v
+-----------+
|  EXECUTOR  |  Runs tools step-by-step
+-----+-----+
      v
+-----------+
|   CRITIC   |--- next_step --> back to EXECUTOR
|            |--- retry ------> back to SUPERVISOR
|            |--- complete ---> END
+-----------+
```

## Tech Stack

- **NestJS 11** - HTTP framework, DI, Swagger
- **LangGraph 1.2** - StateGraph for agent orchestration
- **LangChain 1.x** - Tool abstractions and integrations
- **Mistral LLM** - Chat completion provider
- **Tavily** - Web search API
- **Redis** - Response caching
- **TypeScript 5.7** / **Jest 30**

## Available Tools

| Tool | Description |
|------|-------------|
| `search` | Web search via Tavily |
| `read_file` | Read a local file |
| `write_file` | Write/create a file |
| `list_dir` | List directory contents |
| `tree_dir` | Recursive directory tree |
| `shell_run` | Execute shell commands |
| `llm_summarize` | AI-powered content analysis |
| `git_info` | Git status, log, diff, branches |
| `grep_search` | Pattern search across files |
| `file_patch` | Find/replace within a file |

## Quick Start

```bash
# 1. Install
npm install --legacy-peer-deps

# 2. Configure
cp .env.example .env
# Edit .env with your MISTRAL_API_KEY, TAVILY_API_KEY, REDIS_HOST, REDIS_PORT

# 3. Start Redis
docker compose -f docker/docker-compose.yml up -d

# 4. Run
npm run start:dev
```

## API

**Base URL:** `http://localhost:3000/api`
**Swagger:** `http://localhost:3000/docs`

### POST `/agents/run`

```bash
curl -X POST http://localhost:3000/api/agents/run \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "List all TypeScript files in the src directory"}'
```

### GET `/health`

```bash
curl http://localhost:3000/api/health
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MISTRAL_API_KEY` | Yes | - | Mistral API key |
| `TAVILY_API_KEY` | Yes | - | Tavily search API key |
| `REDIS_HOST` | Yes | - | Redis hostname |
| `REDIS_PORT` | Yes | - | Redis port |
| `PORT` | No | `3000` | HTTP server port |
| `MISTRAL_MODEL` | No | `mistral-small-latest` | LLM model |
| `AGENT_MAX_ITERATIONS` | No | `3` | Max agent loop iterations |
| `AGENT_WORKING_DIR` | No | `process.cwd()` | Sandbox root for file tools |

See [CLAUDE.md](CLAUDE.md) for the full variable reference.

## Development

```bash
npm run build          # Production build
npm run lint           # ESLint with auto-fix
npm run format         # Prettier
npm run test           # Unit tests
npm run test:cov       # Coverage report
npm run test:e2e       # End-to-end tests
```

## Adding a New Tool

1. Create `src/modules/agents/tools/<name>.tool.ts`
2. Define Zod input schema
3. Register in `src/modules/agents/tools/index.ts`

## License

MIT
