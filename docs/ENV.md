# Environment Variables Reference

| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `MISTRAL_API_KEY` | Yes | — | Mistral API key |
| `TAVILY_API_KEY` | Yes | — | Tavily API key for web search |
| `REDIS_HOST` | Yes | — | Redis server hostname |
| `AGENT_MAX_ITERATIONS` | No | `3` | Max graph iterations (1–10) |
| `QDRANT_URL` | No | `http://localhost:6333` | Vector DB URL |

*Note: Full list and Joi validation logic found in `src/common/config/env.ts`.*
