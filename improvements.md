# Improvements (roadmap / backlog)

This file lists high-signal improvements for `nest-langgraph-ai`, prioritized by impact and effort.

## P0 — Correctness / stability

- **Make LLM provider truly configurable**
  - `src/modules/llm/llm.provider.ts` should use only validated `env` values (key/model/timeout/temperature) and avoid hardcoded strings.
  - Consider adding `LLM_TEMPERATURE` (and maybe `LLM_MAX_TOKENS`) to `src/common/config/env.ts` so runtime behavior is explicit and testable.

- **Harden JSON extraction + schema validation at node boundaries**
  - Supervisor / planner / critic outputs are critical control signals; ensure they’re always parsed via `extractJson()` and validated against a Zod schema with clear error messages and safe fallbacks.

- **Reduce “hang” risk during tool execution**
  - Ensure all tools respect `TOOL_TIMEOUT_MS` (including HTTP/Splunk tools) and surface timeouts as structured `ERROR ...` strings so the critic can reliably react.

## P1 — Developer experience

- **Docs alignment**
  - Keep `README.md`, `CLAUDE.md`, and `.env.example` generated from (or at least validated against) `src/common/config/env.ts` to avoid drift.

- **Add a “smoke” test**
  - One Jest test that boots the Nest app module and hits `/health` and `/agents/run` with mocked LLM/tools, to catch wiring regressions early.

- **CI improvements**
  - Add `npm run lint` to `.github/workflows/ci.yml` so style issues don’t accumulate.

## P2 — Product / capability

- **Vector DB integration**
  - Implement `EmbeddingService.embed()` and wire Qdrant into the agent loop (e.g., retrieve relevant past artifacts or project docs into planner context).

- **Session memory**
  - Store conversation summaries per `sessionId` (Redis/Qdrant) and rehydrate them into prompts to improve multi-turn coherence.

- **Tool permission model**
  - Add per-session or per-request “allowlist” controls (e.g., disable `shell_run` in production) and log all tool invocations with structured metadata.

## P3 — Observability / operations

- **Structured tracing**
  - Emit a run-level `traceId` and attach it to all node logs and tool logs (and optionally return it to the client).

- **Metrics**
  - Track node durations, tool success rates, retry counts, and timeout counts (Prometheus/OpenTelemetry).

