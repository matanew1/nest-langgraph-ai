# nest-langgraph-ai | Reference Guide

## Architecture
- **Framework:** NestJS 11 + LangGraph 1.2 (Stateful Multi-Agent).
- **Core Loop:** Supervisor → [Researcher|Planner|Executor|Critic] → Generator.
- **LLM Access:** Use `invokeLlm()` from `@llm/llm.provider.ts`. Select tier via `selectModelForTier()`.
- **JSON:** Inline repair via `parseWithRepair` in `@nodes/parse-with-repair.util.ts`.

## Critical Guidelines
- **State:** Mutate ONLY via `transitionToPhase()` in `@state/agent.state.ts`.
- **Safety:** Always wrap paths in `sandboxPath()` from `@utils/path.util.ts`.
- **Nodes:** All nodes must be wrapped in `safeNodeHandler()`.
- **Naming:** Use constants from `graph/agent-node-names.ts` for node names.
- **Locking:** Redis-backed session locking is handled in `agents.service.ts`.

## Commands
- **Dev:** `npm run start:dev`
- **Test:** `npm run test`
- **Fix:** `npm run lint`