# Repository Layout

## Top-Level

```
nest-langgraph-ai/
├── src/                     # Application source
├── docs/                    # Reference documentation
├── docker/                  # Docker Compose stack
├── diagram/                 # Mermaid graph diagrams
├── public/                  # Static HTML files (plan-review UI)
├── test/                    # E2E and integration tests
├── example/                 # Example files / fixtures
├── .env.example             # Environment template
├── CLAUDE.md                # AI coding reference guide
└── README.md                # Project overview
```

## Source Tree (`src/`)

```
src/
├── main.ts                              # NestJS bootstrap (ValidationPipe, AllExceptionsFilter, LoggingInterceptor, TimeoutInterceptor, ApiKeyGuard)
├── app.module.ts                        # Root module (ThrottlerModule, ServeStaticModule, agents/llm/redis/vector-db/health/metrics + RequestIdMiddleware)
├── common/
│   ├── config/
│   │   └── env.ts                       # Joi-validated env schema (all variables incl. API_KEY, LOG_FORMAT)
│   ├── decorators/
│   │   ├── api-standard-response.decorator.ts     # @ApiStandardResponse Swagger helper
│   │   ├── api-standard-delete-response.decorator.ts # @ApiStandardDeleteResponse Swagger helper
│   │   └── api-session-id-param.decorator.ts      # @ApiSessionIdParam Swagger helper
│   ├── dto/
│   │   └── error-response.dto.ts        # Standard error envelope DTO
│   ├── filters/
│   │   └── http-exception.filter.ts     # Global AllExceptionsFilter
│   ├── guards/
│   │   └── api-key.guard.ts             # API key authentication guard (Bearer / x-api-key; skips /health)
│   ├── interceptors/
│   │   ├── logging.interceptor.ts       # Request/response logging (duration, errors)
│   │   └── timeout.interceptor.ts       # Global request timeout
│   ├── middleware/
│   │   └── request-id.middleware.ts      # X-Request-Id propagation via AsyncLocalStorage
│   └── utils/
│       ├── path.util.ts                 # sandboxPath() — MUST wrap all file paths
│       ├── pretty-log.util.ts           # Phase logging helpers (logPhaseStart/End, startTimer, preview, prettyJson)
│       └── json.util.ts                 # extractJson() — JSON extraction and repair with stage tracking
├── extensions/
│   ├── extensions.ts                    # Prototype extensions
│   └── global.d.ts                      # Global type declarations
└── modules/
    ├── agents/                          # Core agent module
    │   ├── agents.module.ts
    │   ├── agents.controller.ts         # REST + SSE endpoints (run, stream, session CRUD, plan review)
    │   ├── agents.service.ts            # Thin orchestrator: run() / streamRun() / cache / vector upsert; delegates to sub-services
    │   ├── services/
    │   │   ├── session-memory.service.ts    # tryLoad(), getSessionMemory(), addEntry(), persist(), merge()
    │   │   ├── plan-review.service.ts       # approve(), reject(), replan(), getReviewPageData()
    │   │   ├── session.service.ts           # listSessions(), getSessionDetail(), deleteSession()
    │   │   └── feedback.service.ts          # submitFeedback(), getFeedbackStats()
    │   ├── agents.dto.ts                # RunAgentDto, StreamAgentDto, StreamEventDto, RunAgentResponseDto
    │   ├── graph/
    │   │   ├── agent.graph.ts           # LangGraph StateGraph assembly (buildAgentGraph)
    │   │   ├── agent-node-names.ts      # Node name string constants (leaf module, no node/topology imports)
    │   │   ├── agent-topology.ts        # Node registry, phase→node routing map, safeNodeHandler error boundary
    │   │   ├── agent-topology.spec.ts   # Topology tests
    │   │   └── agent.config.ts          # Graph config (getAgentLimits, AGENT_PLAN_LIMITS, AGENT_CONSTANTS, CIRCUIT_BREAKER_CONFIG, RESEARCH_CONFIG)
    │   ├── nodes/                       # 17 LangGraph nodes
    │   │   ├── supervisor.node.ts       # Intent classification → chat or agent (action-keyword detection)
    │   │   ├── researcher-coordinator.node.ts # Fan-out coordinator for parallel research branches
    │   │   ├── research-fs.node.ts      # Filesystem context gathering (file tree, git status) with timeouts
    │   │   ├── research-vector.node.ts  # Vector memory context gathering with timeouts
    │   │   ├── research-join.node.ts    # Joins parallel research branches
    │   │   ├── planner.node.ts          # Multi-step plan generation (Zod JSON)
    │   │   ├── plan-validator.node.ts   # Tool/param validation; optional human review gate
    │   │   ├── await-plan-review.node.ts # Human-in-the-loop pause (LangGraph interrupt)
    │   │   ├── execution.node.ts        # Single-step tool execution with AbortController timeout
    │   │   ├── parallel-execution.node.ts # Parallel tool execution with __PREVIOUS_RESULT__ validation
    │   │   ├── tool-result-normalizer.node.ts # Raw output → ToolResult envelope (includes replanGeneration)
    │   │   ├── critic.node.ts           # advance/retry/replan/complete/fatal decision
    │   │   ├── generator.node.ts        # Final answer synthesis from attempts (with empty-output retry)
    │   │   ├── memory-persist.node.ts   # Vector DB upsert with dedup (cosine > 0.95 = update)
    │   │   ├── memory-persist.node.spec.ts # Co-located spec
    │   │   ├── chat.node.ts             # Conversational fast-path response
    │   │   ├── terminal-response.node.ts # Fatal / clarification terminal states
    │   │   ├── decision-router.node.ts  # Phase-driven routing with extracted helper functions and replanGeneration tracking
    │   │   ├── parse-with-repair.util.ts # Inline JSON parse + regex fallback + LLM repair (10s timeout, 0 retries)
    │   │   └── structured-output.util.ts # Shared: getStructuredNodeRawResponse, parseStructuredNodeOutput
    │   ├── state/
    │   │   ├── agent-phase.ts           # AGENT_PHASES enum + ROUTABLE_AGENT_PHASES
    │   │   ├── agent.state.ts           # AgentStateShape + AgentStateAnnotation (LangGraph reducers)
    │   │   ├── agent.schemas.ts         # Zod schemas for LLM structured outputs (supervisor, planner, critic)
    │   │   ├── agent-state.helpers.ts   # State query helpers (incrementAgentCounters)
    │   │   ├── agent-state.helpers.spec.ts
    │   │   ├── agent-transition.util.ts # transitionToPhase() with phase transition validation, failAgentRun(), requestClarification()
    │   │   ├── agent-transition.util.spec.ts
    │   │   ├── agent-run-state.util.ts  # createInitialAgentRunState(), completeAgentRun()
    │   │   └── agent-run-state.util.spec.ts
    │   ├── prompts/
    │   │   ├── agent.prompts.ts         # Prompt builder functions (one per node)
    │   │   ├── prompt-context.util.ts   # formatAttempts(), getAvailableTools(), JSON_ONLY, SELF_REFLECTION
    │   │   ├── prompt-context.util.spec.ts
    │   │   ├── prompt-template.util.ts  # renderPromptTemplate(), getPromptTemplate()
    │   │   ├── prompt-template.util.spec.ts
    │   │   └── templates/               # .txt template files
    │   │       ├── supervisor.txt       # Supervisor node prompt template
    │   │       ├── planner.txt          # Planner node prompt template
    │   │       └── critic.txt           # Critic node prompt template
    │   ├── tools/
    │   │   ├── tool.registry.ts         # ToolRegistry class (register, get, describeForPrompt with cache)
    │   │   ├── tool.registry.spec.ts
    │   │   ├── tool.catalog.ts          # Tool registrations list (25 tools)
    │   │   ├── tool-result.ts           # ToolResult interface + toToolResult()
    │   │   ├── index.ts                 # Re-exports toolRegistry singleton
    │   │   ├── read-file.tool.ts        # read_file
    │   │   ├── write-file.tool.ts       # write_file
    │   │   ├── delete-file.tool.ts      # delete_file — delete a file or empty dir
    │   │   ├── move-file.tool.ts        # move_file — rename/move a file or dir
    │   │   ├── list-dir.tool.ts         # list_dir
    │   │   ├── tree-dir.tool.ts         # tree_dir
    │   │   ├── glob-files.tool.ts       # glob_files
    │   │   ├── read-files-batch.tool.ts # read_files_batch
    │   │   ├── stat-path.tool.ts        # stat_path
    │   │   ├── file-patch.tool.ts       # file_patch
    │   │   ├── grep-search.tool.ts      # grep_search
    │   │   ├── ast-parse.tool.ts        # ast_parse
    │   │   ├── search.tool.ts           # search (Tavily)
    │   │   ├── llm-summarize.tool.ts    # llm_summarize
    │   │   ├── vector-upsert.tool.ts    # vector_upsert
    │   │   ├── vector-search.tool.ts    # vector_search
    │   │   ├── generate-mermaid.tool.ts # generate_mermaid
    │   │   ├── read-mermaid.tool.ts     # read_mermaid
    │   │   ├── edit-mermaid.tool.ts     # edit_mermaid
    │   │   ├── git-info.tool.ts         # git_info
    │   │   ├── run-command.tool.ts      # run_command — execute shell commands (destructive)
    │   │   ├── http-get.tool.ts         # http_get — HTTP GET with SSRF guard
    │   │   ├── http-post.tool.ts        # http_post — HTTP POST with SSRF guard (destructive)
    │   │   ├── system-info.tool.ts      # system_info
    │   │   ├── mermaid.util.ts          # Shared Mermaid helpers
    │   │   ├── http-request.util.ts     # Shared HTTP + SSRF guard + redirect-limiting logic
    │   │   └── state-graph-extractor.ts # LangGraph state graph introspection helper
    │   ├── tests/                       # Node, tool, and integration test files
    │   │   ├── agents.controller.spec.ts
    │   │   ├── agents.service.spec.ts
    │   │   ├── agent.prompts.spec.ts
    │   │   ├── chat.node.spec.ts
    │   │   ├── critic.node.spec.ts
    │   │   ├── decision-router.node.spec.ts
    │   │   ├── execution.node.spec.ts
    │   │   ├── generator.node.spec.ts
    │   │   ├── parse-with-repair.util.spec.ts
    │   │   ├── plan-validator.node.spec.ts
    │   │   ├── planner.node.spec.ts
    │   │   ├── researcher.node.spec.ts
    │   │   ├── supervisor.node.spec.ts
    │   │   ├── terminal-response.node.spec.ts
    │   │   ├── tool-result-normalizer.node.spec.ts
    │   │   ├── ast-parse.tool.spec.ts
    │   │   ├── edit-mermaid.tool.spec.ts
    │   │   ├── file-patch.tool.spec.ts
    │   │   ├── generate-mermaid.tool.spec.ts
    │   │   ├── git-info.tool.spec.ts
    │   │   ├── glob-files.tool.spec.ts
    │   │   ├── grep-search.tool.spec.ts
    │   │   ├── memory-persist.node.spec.ts
    │   │   ├── http-get.tool.spec.ts
    │   │   ├── http-post.tool.spec.ts
    │   │   └── json.util.spec.ts
    │   └── utils/
    │       ├── redis-saver.ts           # LangGraph checkpoint saver (Redis) + session memory + thread management
    │       ├── redis-saver.provider.ts  # NestJS provider factory for RedisSaver DI
    │       └── redis-saver.spec.ts
    ├── llm/
    │   ├── llm.module.ts
    │   ├── llm.provider.ts              # invokeLlm/streamLlm with per-session circuit breaker, retry, AbortController timeout; per-model instance cache
    │   ├── model-router.ts              # selectModelForTier() / selectModelForPhase() — maps phases to FAST/BALANCED/POWERFUL/CODE tier models
    │   ├── llm.provider.spec.ts
    │   └── llm-stream.spec.ts
    ├── metrics/
    │   ├── metrics.module.ts            # Global module exporting MetricsService
    │   ├── metrics.service.ts           # Prometheus-compatible counters, histograms, gauges
    │   └── metrics.controller.ts        # GET /metrics (Prometheus text exposition format)
    ├── redis/
    │   ├── redis.module.ts
    │   ├── redis.module.spec.ts
    │   ├── redis.provider.ts            # IORedis client provider
    │   └── redis.constants.ts
    ├── vector-db/
    │   ├── vector.module.ts             # VectorModule (EmbeddingService, Qdrant client, onModuleInit warm-up)
    │   ├── vector.module.spec.ts
    │   ├── qdrant.provider.ts           # Qdrant client + auto-collection creation
    │   ├── qdrant.provider.spec.ts
    │   ├── embedding.service.ts         # @xenova/transformers local embeddings (all-MiniLM-L6-v2, 384-dim)
    │   ├── vector-memory.util.ts        # searchVectorMemories(), upsertVectorMemory(), buildVectorResearchContext() with LRU cache
    │   ├── vector-memory.util.spec.ts
    │   └── vector.constants.ts
    └── health/
        ├── health.module.ts
        ├── health.controller.ts         # /health, /health/live, /health/ready, /health/dependencies
        ├── health.service.ts            # Dependency health checks (Redis, Qdrant, Mistral, Tavily)
        ├── health.service.spec.ts
        └── health.types.ts
```

## Key Path Aliases (`tsconfig.json`)

| Alias | Resolves to |
|-------|------------|
| `@config/*` | `src/common/config/*` |
| `@utils/*` | `src/common/utils/*` |
| `@common/*` | `src/common/*` |
| `@llm/*` | `src/modules/llm/*` |
| `@redis/*` | `src/modules/redis/*` |
| `@agents/*` | `src/modules/agents/*` |
| `@nodes/*` | `src/modules/agents/nodes/*` |
| `@tools/*` | `src/modules/agents/tools/*` |
| `@state/*` | `src/modules/agents/state/*` |
| `@graph/*` | `src/modules/agents/graph/*` |
| `@vector-db/*` | `src/modules/vector-db/*` |
| `@health/*` | `src/modules/health/*` |

## Infrastructure (`docker/`)

- `docker-compose.yml` — Redis 7, Qdrant latest, Redis Commander (profile: `tools`)

## Prompt Templates (`src/modules/agents/prompts/templates/`)

One `.txt` file per node. Variables use `{{variableName}}` syntax rendered by `renderPromptTemplate()`.

| File | Used by |
|------|---------|
| `supervisor.txt` | `supervisor.node.ts` |
| `planner.txt` | `planner.node.ts` |
| `critic.txt` | `critic.node.ts` |

## Test Files

Tests are co-located with their modules or in dedicated `tests/` directories:
- **Node tests:** `src/modules/agents/tests/<node-name>.spec.ts` (15 files)
- **Tool tests:** `src/modules/agents/tests/<tool-name>.spec.ts` (10 files)
- **Service tests:** `src/modules/agents/tests/agents.{controller,service}.spec.ts`
- **State tests:** `src/modules/agents/state/*.spec.ts` (3 files)
- **Prompt tests:** `src/modules/agents/prompts/*.spec.ts` (2 files)
- **Module tests:** `src/modules/{redis,vector-db,health}/*.spec.ts`
- **LLM tests:** `src/modules/llm/llm.provider.spec.ts`, `src/modules/llm/llm-stream.spec.ts`
- **Tool utils:** `src/modules/agents/tools/http-request.util.ts` (SSRF guard, shared by `http_get`/`http_post`)
