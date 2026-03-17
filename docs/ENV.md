# Environment Variables Reference

| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `MISTRAL_API_KEY` | Yes | — | Mistral API key |
| `TAVILY_API_KEY` | Yes | — | Tavily API key for web search |
| `REDIS_HOST` | Yes | — | Redis server hostname |
| `AGENT_MAX_ITERATIONS` | No | `3` | Max graph iterations (1–10) |
| `QDRANT_URL` | No | `http://localhost:6333` | Vector DB URL |
| `QDRANT_CHECK_COMPATIBILITY` | No | `false` | Enable Qdrant client/server version compatibility checks at startup |

*Note: Docker Compose overrides `REDIS_HOST`, `QDRANT_URL`, and `AGENT_WORKING_DIR` for the app container so your host `.env` can keep using `localhost`. Full Joi validation logic is in `src/common/config/env.ts`.*
