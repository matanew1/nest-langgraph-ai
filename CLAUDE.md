# nest-langgraph-ai | Reference Guide

## Context & Architecture
NestJS 11 + LangGraph 1.2 multi-agent workflow with a phase-driven state machine.
- **LLM:** Mistral (via `invokeLlm()` in `llm.provider.ts`) with circuit breaker, retry, and AbortController timeout.
- **State:** Stateful sessions via Redis (IORedis checkpoints) + Qdrant (Vector DB for semantic memory).
- **Core Loop:**
  - Conversational fast-path: `Supervisor → Chat → Complete`
  - Full agent pipeline: `Supervisor → Researcher → Planner → Validator → [AwaitPlanReview] → Execute → Normalize → Critic → Router → Generator → Complete`
  - Error paths: `terminal_response` (fatal/clarification); malformed LLM JSON is repaired inline via `parseWithRepair` within each LLM node (no dedicated node)
- **Error boundaries:** All nodes wrapped in `safeNodeHandler()` (catches unhandled exceptions → `failAgentRun()`).

## Graph Nodes (12 total)

| Phase | Node file |
|-------|-----------|
| `supervisor` | `nodes/supervisor.node.ts` |
| `research` | `nodes/researcher.node.ts` |
| `plan` | `nodes/planner.node.ts` |
| `validate_plan` | `nodes/plan-validator.node.ts` |
| `await_plan_review` | `nodes/await-plan-review.node.ts` |
| `execute` | `nodes/execution.node.ts` |
| `normalize_tool_result` | `nodes/tool-result-normalizer.node.ts` |
| `judge` | `nodes/critic.node.ts` |
| `generate` | `nodes/generator.node.ts` |
| `chat` | `nodes/chat.node.ts` |
| `fatal_recovery / clarification` | `nodes/terminal-response.node.ts` |
| — (routing) | `nodes/decision-router.node.ts` |

> JSON repair is now inline: `parseWithRepair` in `nodes/parse-with-repair.util.ts` is called directly by each LLM node; there is no dedicated `json_repair` graph node.

## Key Constants (`graph/agent.config.ts`)
- `AGENT_CONSTANTS`: `chatMemoryMaxChars`, `researcherTreeMaxLines`, `rawResultMaxBytes`, `attemptsHistoryCap`, `errorsHistoryCap`, `checkpointHistoryLimit`
- `AGENT_PLAN_LIMITS`: `maxSteps: 20`
- `getAgentLimits()`: derives `turns`, `toolCalls`, `replans`, `stepRetries`, `supervisorFallbacks` from env vars

## Development Checklist
- **Setup:** `npm install --legacy-peer-deps`, `npm run docker:up`
- **Run:** `npm run start:dev` | **Test:** `npm run test`
- **Lint:** `npm run lint` (Conventional Commits required).
- **21 tools** registered in `tools/tool.catalog.ts`

## Critical Guidelines
- **No Direct LLM Calls:** Use `@llm/llm.provider.ts` → `invokeLlm()`.
- **File Safety:** ALWAYS wrap paths in `sandboxPath()` from `@utils/path.util.ts`.
- **State:** Mutate ONLY via annotated reducers in `@state/agent.state.ts`. Use helpers in `agent-transition.util.ts` and `agent-run-state.util.ts`.
- **Phase transitions:** Use `transitionToPhase()` — never set `phase` directly.
- **Error boundaries:** Use `safeNodeHandler()` in `agent-topology.ts` for all new nodes.
- **Aliases:** Use `@agents/*`, `@nodes/*`, `@tools/*`, `@state/*`, `@graph/*`, etc. (See `tsconfig.json`).

## Extended Reference (Read only if needed)
- **Env Vars:** See `docs/ENV.md`
- **Available Tools:** See `docs/TOOLS.md`
- **Full Layout:** See `docs/LAYOUT.md`
- **Prompts:** `.txt` templates in `src/modules/agents/prompts/templates/`.
