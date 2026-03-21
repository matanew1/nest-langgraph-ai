# Agent Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement 4 features — token streaming, parallel tool execution, session memory API, and conversation feedback loop.

**Architecture:** Each feature is independent. Features 1 & 2 modify the agent graph pipeline. Features 3 & 4 add REST endpoints and Qdrant integration. All additive — no breaking changes.

**Tech Stack:** NestJS 11, LangGraph 1.2, Mistral LLM, Redis (IORedis), Qdrant, Zod, Jest

**Spec:** `docs/superpowers/specs/2026-03-20-agent-enhancements-design.md`

## Already Done (from prior session)

The following changes are already committed in `7e59a14`:
- `PlanStep.parallel_group?: number` added to `agent.state.ts`
- `parallelResult?: boolean`, `onToken?`, `streamPhases?`, `vectorMemoryIds?` on `AgentStateShape`
- `parallelResult` annotation with reducer in `AgentStateAnnotation`
- `EXECUTE_PARALLEL` phase in `agent-phase.ts` + `ROUTABLE_AGENT_PHASES`
- `parallel_group` in Zod `planStepSchema` (`agent.schemas.ts`)
- Test stubs: `llm-stream.spec.ts`, `parallel-execution.node.spec.ts`
- Bug fixes: GraphBubbleUp re-throw, `__PREVIOUS_RESULT__` skip, humanized errors

## Remaining Tasks

### Task 1: Implement `streamLlm()` in LLM Provider
- **Create:** `streamLlm()` async generator in `src/modules/llm/llm.provider.ts`
- Same circuit breaker, retry, timeout as `invokeLlm()`
- Uses `llm.stream()` from ChatMistralAI base class
- Test: `src/modules/agents/llm-stream.spec.ts` (already exists, needs passing)

### Task 2: Wire Streaming into Chat & Generator Nodes
- **Modify:** `src/modules/agents/nodes/chat.node.ts` — use `streamLlm()` when `state.onToken` present
- **Modify:** `src/modules/agents/nodes/generator.node.ts` — same pattern
- **Modify:** `src/modules/agents/agents.dto.ts` — add `streamPhases` to `StreamAgentDto`, `llm_stream_reset` to event types
- Tests: update `chat.node.spec.ts`, `generator.node.spec.ts`

### Task 3: Wire `onToken` in `streamRun()` SSE Pipeline
- **Modify:** `src/modules/agents/agents.service.ts` — add `streamPhases` param, set `onToken` callback
- **Modify:** `src/modules/agents/agents.controller.ts` — pass `streamPhases` through

### Task 4: Implement `parallelExecutionNode`
- **Create:** `src/modules/agents/nodes/parallel-execution.node.ts`
- Collects contiguous steps with same `parallel_group`, executes via `Promise.allSettled()`
- Each tool gets own AbortController timeout, partial failure handling
- Test: `src/modules/agents/parallel-execution.node.spec.ts` (already exists, needs passing)

### Task 5: Register Parallel Node & Update Routing
- **Fix:** `src/modules/agents/graph/agent-topology.ts` line 129 — replace `execute_parallel: 'supervisor'` placeholder with proper node registration
- **Modify:** `src/modules/agents/nodes/decision-router.node.ts` — route to EXECUTE_PARALLEL when next step has parallel_group
- **Modify:** `src/modules/agents/nodes/plan-validator.node.ts` — validate contiguous groups, reject `__PREVIOUS_RESULT__` in groups
- **Modify:** `src/modules/agents/nodes/tool-result-normalizer.node.ts` — handle parallel result arrays
- **Modify:** `src/modules/agents/prompts/templates/planner.txt` — add parallel_group instructions
- **Add:** `maxParallelTools: 5` to `AGENT_CONSTANTS` in `agent.config.ts`

### Task 6: Session Memory API
- **Modify:** `src/modules/agents/agents.dto.ts` — add `AddMemoryEntryDto`, `SessionMemoryResponseDto`
- **Modify:** `src/modules/agents/agents.service.ts` — add `getSessionMemory()`, `addSessionMemoryEntry()`, `clearSessionMemory()`
- **Modify:** `src/modules/agents/agents.controller.ts` — add GET/POST/DELETE `/agents/session/:sessionId/memory`

### Task 7: Feedback Loop — Vector ID Tracking
- **Modify:** `src/modules/agents/utils/redis-saver.ts` — add `setVectorMemoryIds()`, `getVectorMemoryIds()`
- **Modify:** `src/modules/vector-db/vector-memory.util.ts` — `buildVectorResearchContext()` returns `{ text, ids }`, add salience re-ranking, add `updatePointSalience()`
- **Modify:** `src/modules/agents/nodes/researcher.node.ts` — store vector IDs on state
- **Modify:** `src/modules/agents/agents.service.ts` — persist vector IDs post-run

### Task 8: Feedback Endpoints
- **Modify:** `src/modules/agents/agents.dto.ts` — add `SubmitFeedbackDto`, `FeedbackStatsResponseDto`
- **Modify:** `src/modules/agents/agents.service.ts` — add `submitFeedback()`, `getFeedbackStats()` with idempotency
- **Modify:** `src/modules/agents/agents.controller.ts` — add POST feedback, GET stats endpoints

### Task 9: Integration & Documentation
- Run full test suite, lint, build
- Update `README.md`, `CLAUDE.md`, `docs/`

## Execution Order & Dependencies

```
Task 1 (streamLlm)         — independent
Task 2 (node wiring)       — depends on Task 1
Task 3 (SSE wiring)        — depends on Task 2
Task 4 (parallel node)     — independent
Task 5 (routing/topology)  — depends on Task 4
Task 6 (memory API)        — independent
Task 7 (vector ID track)   — independent
Task 8 (feedback)          — depends on Task 7
Task 9 (integration)       — depends on ALL
```

**Parallelizable:** {1,2,3} | {4,5} | {6} | {7,8} can all proceed independently.
