# Environment Variables Reference

| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `MISTRAL_API_KEY` | Yes | — | Mistral API key |
| `TAVILY_API_KEY` | Yes | — | Tavily API key for web search |
| `REDIS_HOST` | Yes | — | Redis server hostname |
| `AGENT_MAX_ITERATIONS` | No | `3` | Base recovery-cycle limit used for router hard stops and derived tool-call caps |
| `HTTP_TOOL_ALLOWED_HOSTS` | No | `""` | Optional comma-separated hostname allowlist for `http_get`/`http_post` |
| `HTTP_TOOL_ALLOW_PRIVATE_NETWORKS` | No | `false` | Allow localhost/private/link-local HTTP targets for tools |
| `HTTP_TOOL_MAX_REDIRECTS` | No | `3` | Max validated redirects for `http_get`/`http_post` |
| `HEALTH_EXTERNAL_CHECK_TIMEOUT_MS` | No | `2000` | Timeout for optional Mistral/Tavily health diagnostics |
| `HEALTH_EXTERNAL_CACHE_TTL_MS` | No | `60000` | Cache TTL for optional dependency diagnostics |
| `QDRANT_URL` | No | `http://localhost:6333` | Vector DB URL |
| `QDRANT_CHECK_COMPATIBILITY` | No | `false` | Enable Qdrant client/server version compatibility checks at startup |

*Note: Docker Compose overrides `REDIS_HOST`, `QDRANT_URL`, and `AGENT_WORKING_DIR` for the app container so your host `.env` can keep using `localhost`. `HTTP_TOOL_ALLOWED_HOSTS` accepts exact hosts like `api.github.com` and suffix rules like `*.openai.com`. Full Joi validation logic is in `src/common/config/env.ts`.*
