# nest-langgraph-ai | Reference Guide

## Context & Architecture
NestJS 11 + LangGraph 1.2 multi-agent workflow (Supervisor -> Researcher -> Planner -> Executor -> Critic).
- **LLM:** Mistral (via `invokeLlm()` in `llm.provider.ts`).
- **State:** Stateful sessions via Redis (IORedis) + Qdrant (Vector DB).
- **Core Loop:** Start -> Supervisor -> Researcher -> Planner -> Validator -> Execute -> Normalize -> Critic -> End.

## Development Checklist
- **Setup:** `npm install --legacy-peer-deps`, `docker compose -f docker/docker-compose.yml up -d`
- **Run:** `npm run start:dev` | **Test:** `npm run test`
- **Lint:** `npm run lint` (Conventional Commits required).

## Critical Guidelines
- **No Direct LLM Calls:** Use `@llm/llm.provider.ts` -> `invokeLlm()`.
- **File Safety:** ALWAYS wrap paths in `sandboxPath()` from `@utils/path.util.ts`.
- **State:** Mutate ONLY via annotated reducers in `@state/agent.state.ts`.
- **Aliases:** Use `@agents/*`, `@nodes/*`, `@tools/*`, etc. (See `tsconfig.json`).

## Extended Reference (Read only if needed)
- **Env Vars:** See `@docs/ENV.md`
- **Available Tools:** See `@docs/TOOLS.md`
- **Full Layout:** See `@docs/LAYOUT.md`
- **Prompts:** `.txt` templates in `src/modules/agents/prompts/templates/`.