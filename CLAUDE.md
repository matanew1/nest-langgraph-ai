# nest-langgraph-ai | Reference Guide

## Context & Architecture
NestJS 11 + LangGraph 1.2 multi-agent workflow with a phase-driven state machine.
- **LLM:** Mistral (via `invokeLlm()` in `llm.provider.ts`) with circuit breaker, retry, and AbortController timeout.
- **State:** Stateful sessions via Redis (IORedis checkpoints) + Qdrant (Vector DB for semantic memory).
- **Core Loop:**
  - Conversational fast-path: `Supervisor → Chat → Router → Complete`
  - Full agent pipeline: `Supervisor → ResearcherCoordinator → [ResearchFS ‖ ResearchVector] → ResearchJoin → Planner → Validator → [AwaitPlanReview] → Execute → Normalize → Critic → Router → Generator → [fan-out: Router → Complete ‖ MemoryPersist]`
  - Parallel execution variant: `Execute → ExecuteParallel → Normalize`
  - Error paths: `terminal_response` (fatal/clarification); malformed LLM JSON is repaired inline via `parseWithRepair` within each LLM node (no dedicated node)
- **Error boundaries:** All nodes wrapped in `safeNodeHandler()` (catches unhandled exceptions → `failAgentRun()`).

## Graph Nodes (17 total)

| Phase / Role | Node file |
|---|---|
| `supervisor` | `nodes/supervisor.node.ts` |
| `researcher_coordinator` | `nodes/researcher-coordinator.node.ts` |
| `research_fs` | `nodes/research-fs.node.ts` |
| `research_vector` | `nodes/research-vector.node.ts` |
| `research_join` | `nodes/research-join.node.ts` |
| `planner` | `nodes/planner.node.ts` |
| `plan_validator` | `nodes/plan-validator.node.ts` |
| `await_plan_review` | `nodes/await-plan-review.node.ts` |
| `execute` | `nodes/execution.node.ts` |
| `execute_parallel` | `nodes/parallel-execution.node.ts` |
| `tool_result_normalizer` | `nodes/tool-result-normalizer.node.ts` |
| `critic` | `nodes/critic.node.ts` |
| `generator` | `nodes/generator.node.ts` |
| `memory_persist` | `nodes/memory-persist.node.ts` |
| `chat` | `nodes/chat.node.ts` |
| `fatal_recovery / clarification` | `nodes/terminal-response.node.ts` |
| — (routing) | `nodes/decision-router.node.ts` |

> JSON repair is now inline: `parseWithRepair` in `nodes/parse-with-repair.util.ts` is called directly by each LLM node; there is no dedicated `json_repair` graph node.
> Node name string constants live in `graph/agent-node-names.ts` (leaf module, no node/topology imports) and are re-exported from `agent-topology.ts` for backwards compatibility.

## Key Constants (`graph/agent.config.ts`)
- `AGENT_CONSTANTS`: `chatMemoryMaxChars`, `researcherTreeMaxLines`, `rawResultMaxBytes`, `attemptsHistoryCap`, `errorsHistoryCap`, `checkpointHistoryLimit`, `maxParallelTools`
- `AGENT_PLAN_LIMITS`: `maxSteps: 20`
- `CIRCUIT_BREAKER_CONFIG`: `threshold: 5`, `cooldownMs: 30_000`, `cleanupMs: 120_000`
- `RESEARCH_CONFIG`: `summarizeThreshold: 4_000`
- `getAgentLimits()`: derives `turns`, `toolCalls`, `replans`, `stepRetries`, `supervisorFallbacks` from env vars

## Development Checklist
- **Setup:** `npm install --legacy-peer-deps`, `npm run docker:up`
- **Run:** `npm run start:dev` | **Test:** `npm run test`
- **Lint:** `npm run lint` (Conventional Commits required).
- **21 tools** registered in `tools/tool.catalog.ts`

## Critical Guidelines
- **No Direct LLM Calls:** Use `@llm/llm.provider.ts` → `invokeLlm()`. Pass `sessionId` for per-session circuit breaker scoping.
- **File Safety:** ALWAYS wrap paths in `sandboxPath()` from `@utils/path.util.ts`.
- **State:** Mutate ONLY via annotated reducers in `@state/agent.state.ts`. Use helpers in `agent-transition.util.ts` and `agent-run-state.util.ts`.
- **Phase transitions:** Use `transitionToPhase(phase, updates, fromPhase?)` — never set `phase` directly. `VALID_TRANSITIONS` map logs warnings for unexpected transitions.
- **Error boundaries:** Use `safeNodeHandler()` in `agent-topology.ts` for all new nodes. `terminalResponseNode` and `decisionRouterNode` are also wrapped.
- **Session locking:** `agents.service.ts` acquires a Redis-backed lock per session (120s TTL, NX). Returns 409 Conflict on concurrent mutations.
- **API auth:** `ApiKeyGuard` checks `Authorization: Bearer` or `x-api-key` header. Empty `API_KEY` env disables auth (dev mode). Health endpoints always public.
- **Metrics:** `MetricsService` provides Prometheus counters/histograms/gauges. `GET /metrics` endpoint.
- **Request IDs:** `RequestIdMiddleware` propagates `X-Request-Id` via `AsyncLocalStorage`. Use `getRequestId()` in loggers.
- **Aliases:** Use `@agents/*`, `@nodes/*`, `@tools/*`, `@state/*`, `@graph/*`, etc. (See `tsconfig.json`).

## Extended Reference (Read only if needed)
- **Env Vars:** See `docs/ENV.md`
- **Available Tools:** See `docs/TOOLS.md`
- **Full Layout:** See `docs/LAYOUT.md`
- **Prompts:** `.txt` templates in `src/modules/agents/prompts/templates/`.
