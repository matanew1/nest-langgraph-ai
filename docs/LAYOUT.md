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
├── main.ts                              # NestJS bootstrap
├── app.module.ts                        # Root module
├── common/
│   ├── config/
│   │   └── env.ts                       # Joi-validated env schema (all variables)
│   ├── decorators/                      # Swagger helper decorators
│   ├── dto/                             # Shared DTOs (error response)
│   ├── filters/                         # Global exception filter
│   ├── interceptors/                    # Logging + timeout interceptors
│   └── utils/
│       ├── path.util.ts                 # sandboxPath() — MUST wrap all file paths
│       ├── pretty-log.util.ts           # Phase logging helpers (logPhaseStart/End, preview)
│       └── json.util.ts                 # JSON repair utilities
└── modules/
    ├── agents/                          # Core agent module
    │   ├── agents.module.ts
    │   ├── agents.controller.ts         # REST + SSE endpoints
    │   ├── agents.service.ts            # run() / streamRun() / session management
    │   ├── agents.dto.ts                # RunAgentDto, StreamAgentDto, StreamEventDto
    │   ├── graph/
    │   │   ├── agent.graph.ts           # LangGraph StateGraph assembly
    │   │   ├── agent-topology.ts        # Node registry + phase→node routing map
    │   │   └── agent.config.ts          # Graph config (recursion limit, etc.)
    │   ├── nodes/                       # 13 LangGraph nodes
    │   │   ├── supervisor.node.ts       # Intent classification → chat or agent
    │   │   ├── researcher.node.ts       # Project context gathering
    │   │   ├── planner.node.ts          # Multi-step plan generation (Zod JSON)
    │   │   ├── plan-validator.node.ts   # Tool/param validation; optional review gate
    │   │   ├── await-plan-review.node.ts # Human-in-the-loop pause (interrupt)
    │   │   ├── execution.node.ts        # Single-step tool execution
    │   │   ├── tool-result-normalizer.node.ts # Raw output → ToolResult envelope
    │   │   ├── critic.node.ts           # advance/retry/replan/complete/fatal decision
    │   │   ├── generator.node.ts        # Final answer synthesis from attempts
    │   │   ├── chat.node.ts             # Conversational fast-path response
    │   │   ├── terminal-response.node.ts # Fatal / clarification terminal states
    │   │   ├── decision-router.node.ts  # Phase-driven routing (resolveRouterTarget)
    │   │   ├── json-repair.node.ts      # LLM JSON repair for malformed outputs
    │   │   └── structured-output.util.ts # Shared: getStructuredNodeRawResponse, parseStructuredNodeOutput
    │   ├── state/
    │   │   ├── agent-phase.ts           # AGENT_PHASES enum + ROUTABLE_AGENT_PHASES
    │   │   ├── agent.state.ts           # AgentStateShape + AgentStateAnnotation (LangGraph reducers)
    │   │   ├── agent.schemas.ts         # Zod schemas for LLM structured outputs
    │   │   ├── agent-state.helpers.ts   # State query helpers
    │   │   ├── agent-transition.util.ts # transitionToPhase(), requestClarification(), etc.
    │   │   └── agent-run-state.util.ts  # createInitialAgentRunState(), completeAgentRun(), etc.
    │   ├── prompts/
    │   │   ├── agent.prompts.ts         # Prompt builder functions (one per node)
    │   │   ├── prompt-context.util.ts   # formatAttempts(), getAvailableTools(), JSON_ONLY, SELF_REFLECTION
    │   │   ├── prompt-template.util.ts  # renderPromptTemplate(), getPromptTemplate()
    │   │   └── templates/               # .txt template files (one per node)
    │   ├── tools/
    │   │   ├── tool.registry.ts         # ToolRegistry class
    │   │   ├── tool.catalog.ts          # Tool registrations list
    │   │   ├── tool-result.ts           # ToolResult interface
    │   │   └── *.tool.ts                # Individual tool implementations
    │   └── utils/
    │       └── redis-saver.ts           # LangGraph checkpoint saver (Redis)
    ├── llm/
    │   ├── llm.module.ts
    │   └── llm.provider.ts              # invokeLlm() — ALWAYS use this, never call LLM directly
    ├── redis/
    │   ├── redis.module.ts
    │   ├── redis.provider.ts
    │   └── redis.constants.ts
    ├── vector-db/
    │   ├── vector.module.ts
    │   ├── qdrant.provider.ts           # Qdrant client
    │   ├── embedding.service.ts         # @xenova/transformers local embeddings
    │   ├── vector-memory.util.ts        # upsertVectorMemory(), buildVectorResearchContext()
    │   └── vector.constants.ts
    └── health/
        ├── health.module.ts
        ├── health.controller.ts         # /health, /health/live, /health/ready, /health/dependencies
        ├── health.service.ts
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
| *(others)* | respective nodes |
