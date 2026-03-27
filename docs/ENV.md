# Environment Variables Reference

Full Joi validation logic is in `src/common/config/env.ts`. Docker Compose overrides `REDIS_HOST`, `REDIS_PORT`, `QDRANT_URL`, and `AGENT_WORKING_DIR` for the app container so your host `.env` can keep using `localhost`.

## Required

| Variable | Description |
| :--- | :--- |
| `MISTRAL_API_KEY` | Mistral API key |
| `TAVILY_API_KEY` | Tavily API key for web search |
| `REDIS_HOST` | Redis server hostname |
| `REDIS_PORT` | Redis server port |

## HTTP Server

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | HTTP listen port |
| `CORS_ORIGIN` | `*` | Allowed CORS origin (wildcard warns in production) |
| `ENABLE_SWAGGER` | `false` | Enable Swagger UI at `/docs` (boolean) |
| `NODE_ENV` | `development` | Node environment |
| `API_KEY` | `""` | API key for `Authorization: Bearer` or `x-api-key` auth. Empty = disabled (dev mode). Health endpoints are always public |
| `LOG_FORMAT` | `text` | `text` or `json`. Use `json` for structured logging in production (ELK, Datadog, etc.) |

## LLM (Mistral)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `MISTRAL_MODEL_FAST` | `mistral-small-latest` | Model for fast phases: routing, validation, terminal responses |
| `MISTRAL_MODEL_BALANCED` | `mistral-small-latest` | Model for balanced phases: chat, research, critic evaluation |
| `MISTRAL_MODEL_POWERFUL` | `mistral-large-latest` | Model for heavy phases: planning, final answer generation |
| `MISTRAL_MODEL_CODE` | `codestral-latest` | Model for code-focused phases: execution tasks |
| `MISTRAL_TIMEOUT_MS` | `30000` | LLM call timeout in ms (min 1000) |

## Agent Behaviour

| Variable | Default | Description |
| :--- | :--- | :--- |
| `AGENT_MAX_ITERATIONS` | `3` | Base recovery-cycle limit (1–10); drives router hard stops and derived caps |
| `AGENT_MAX_RETRIES` | `3` | Max step-retry attempts before triggering a replan (1–10) |
| `AGENT_MAX_RETBACKS` | `3` | Max replan cycles before the run is marked fatal (1–10) |
| `AGENT_WORKING_DIR` | `process.cwd()` | Sandbox root — all file-tool paths are resolved inside this directory |
| `REQUIRE_PLAN_REVIEW` | `false` | When `true`, pause after plan validation for human approve/reject/replan |

## Tool Configuration

| Variable | Default | Description |
| :--- | :--- | :--- |
| `TOOL_TIMEOUT_MS` | `15000` | Per-tool invocation timeout in ms (min 1000) |
| `HTTP_TOOL_ALLOWED_HOSTS` | `""` | Comma-separated hostname allowlist for `http_get`/`http_post`. Accepts exact hosts (`api.github.com`) and suffix rules (`*.openai.com`). Empty = allow all non-private hosts |
| `HTTP_TOOL_ALLOW_PRIVATE_NETWORKS` | `false` | Allow localhost / private / link-local HTTP targets |
| `HTTP_TOOL_MAX_REDIRECTS` | `3` | Max validated redirects (0–10) |\n\n**HTTP Tool Notes:**\n- Direct requests to sites like LinkedIn often fail (status 999/403 due to bot detection). Use `search` or Tavily (via `grep-search`/`search`) for web content.\n- To allow specific hosts: `HTTP_TOOL_ALLOWED_HOSTS=api.github.com,*.openai.com`\n- Private networks localhost blocked by default for security.

## Prompt Tuning

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PROMPT_MAX_ATTEMPTS` | `5` | Max recent attempts included in supervisor/planner prompts |
| `PROMPT_MAX_SUMMARY_CHARS` | `2000` | Max chars of session memory passed into prompts |
| `CRITIC_RESULT_MAX_CHARS` | `8000` | Max chars of tool output passed to the critic |

## Caching & Sessions

| Variable | Default | Description |
| :--- | :--- | :--- |
| `CACHE_TTL_SECONDS` | `60` | Redis TTL for cached agent responses |
| `SESSION_TTL_SECONDS` | `86400` | Redis TTL for session state (24 h) |

## Vector DB (Qdrant)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `QDRANT_URL` | `http://localhost:6333` | Qdrant HTTP URL |
| `QDRANT_COLLECTION` | `agent_vectors` | Collection name for agent vector memory |
| `QDRANT_VECTOR_SIZE` | `384` | Embedding dimensions — must match the embedding model (default: `all-MiniLM-L6-v2` = 384) |
| `QDRANT_CHECK_COMPATIBILITY` | `false` | Enable Qdrant client/server version compatibility checks at startup |

## Health Checks

| Variable | Default | Description |
| :--- | :--- | :--- |
| `HEALTH_EXTERNAL_CHECK_TIMEOUT_MS` | `2000` | Timeout for optional Mistral/Tavily health diagnostics (min 100) |
| `HEALTH_EXTERNAL_CACHE_TTL_MS` | `60000` | Cache TTL for dependency diagnostics |
