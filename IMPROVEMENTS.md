# Improvements & Fixes

Generated: 2026-03-19 | Based on multi-agent codebase analysis (77 tests, 48% coverage)

---

## Executive Summary

The nest-langgraph-ai project has a solid architectural foundation — phase-driven state machine, Redis checkpointing, Qdrant vector storage, and a well-structured 13-node LangGraph pipeline. However, three tests are actively failing due to behavioral drift between node implementations and their test assertions, and test coverage sits at 48% overall with 7 of 13 graph nodes having zero tests. The most critical gaps are on the nodes that carry the highest risk: `planner`, `plan-validator`, `json-repair`, and `generator`. Tool coverage is also severely uneven, with several tools at 0% including `git_info`, `grep_search`, `generate_mermaid`, `ast_parse`, `glob_files`, and `file_patch`.

Priority areas:
1. Fix 3 actively failing tests immediately.
2. Add tests for the 7 untested nodes, starting with the critical-path nodes.
3. Raise tool coverage to a minimum of 60% across all 23 tools.
4. Add tests for key utilities (prompt context, vector memory, state helpers).

---

## Immediate Fixes (P0)

These are broken right now and block CI.

### P0-1 — Fix `supervisor.node.spec.ts`: "returns plan_required when LLM approves"

**Problem:** The test expects `phase = 'research'` after the supervisor LLM approves a non-conversational task. The supervisor now routes more aggressively to `CHAT`, so the actual phase returned is `chat`.

**File:** `src/modules/agents/nodes/supervisor.node.spec.ts`

**Root cause:** The supervisor gained a fast-path: if `sessionMemory` is present and the task is deemed conversational, it skips LLM and routes to `CHAT`. The test's mock state likely satisfies that condition unintentionally.

**Fix:** In the test setup for this case, ensure `sessionMemory` is empty or absent, and ensure the mock LLM response returns a decision that unambiguously flags the task as requiring planning (e.g., `requires_plan: true`, `is_conversational: false`). Verify the mock matches whatever schema `supervisor.node.ts` now expects from `invokeLlm()`. Update the assertion to match the actual intended behavior — if `research` is no longer the direct post-supervisor phase, trace the current routing and fix the expected value accordingly.

**Why it matters:** A failing supervisor test means the primary routing decision — which determines the entire agent pipeline — is not validated. Any regression in supervisor logic ships silently.

---

### P0-2 — Fix `supervisor.node.spec.ts`: "routes rejected tasks to clarification with a structured error"

**Problem:** The test expects `phase = 'clarification'` when the supervisor rejects a task. Actual result is `phase = 'chat'`.

**File:** `src/modules/agents/nodes/supervisor.node.spec.ts`

**Root cause:** Same fast-path change as P0-1. The mock state triggers the conversational shortcut before the rejection logic is reached.

**Fix:** Ensure the test mock state does not satisfy the fast-path conditions (no `sessionMemory`, or set `isConversational: false` explicitly in the mock LLM output). Confirm that the LLM mock returns a rejection signal (e.g., `action: 'reject'` or equivalent field the supervisor reads). If the supervisor's rejection-to-clarification routing was intentionally changed, update the assertion to match reality and add a comment explaining the new behavior.

**Why it matters:** The clarification path is the user-facing error recovery route. If it silently stops working, users get a chat response instead of a structured clarification prompt.

---

### P0-3 — Fix `decision-router.node.spec.ts`: "returns complete on last step with complete decision"

**Problem:** The test expects `phase = 'complete'` when the router processes a `complete` decision on the last step. Actual result is `phase = 'generate'`.

**File:** `src/modules/agents/nodes/decision-router.node.spec.ts`

**Root cause:** The router now routes `complete` decisions through `generate` before reaching `complete`. This is a behavioral change in `decision-router.node.ts` that was not reflected in the test.

**Fix:** Determine whether this routing change was intentional (i.e., final answer generation is now always required before completing). If intentional, update the test assertion to expect `phase = 'generate'` and add a separate test that traces the full `generate → complete` path. If unintentional (a regression), revert the routing logic in `decision-router.node.ts` to route `complete` decisions directly to `complete` when on the last step.

**Why it matters:** The router controls all phase transitions after execution. An incorrect routing test means the terminal flow of the entire agent pipeline is unvalidated.

---

## High Priority Improvements (P1)

Critical gaps on nodes that sit on the primary execution path or error recovery path.

### P1-1 — Add tests for `planner.node.ts`

**Problem:** Zero tests exist for the planner node, which generates the multi-step execution plan. This is the most structurally important node after the supervisor.

**File:** `src/modules/agents/nodes/planner.node.ts`

**What to test:**
- Given valid research output, produces a plan with 1–20 steps.
- Each plan step references only tools present in the tool registry (use `getAvailableTools()`).
- File patch steps include valid anchor references.
- Plan is serialized in the format `plan-validator.node.ts` expects (Zod schema).
- Malformed LLM output triggers transition to `json_repair` phase.
- `transitionToPhase()` is called (never direct `phase` assignment).

**Approach:** Mock `invokeLlm()` to return controlled JSON payloads. Test both happy path and error path (invalid JSON, missing fields, too many steps).

**Why it matters:** A broken planner produces plans that fail validation or execution silently. It is the highest-leverage node to test after the supervisor.

---

### P1-2 — Add tests for `plan-validator.node.ts`

**Problem:** Zero tests exist for plan validation. The validator enforces up to 8 distinct rules (non-empty plan, max 20 steps, file_patch anchors, tool registry membership, Zod param validation).

**File:** `src/modules/agents/nodes/plan-validator.node.ts`

**What to test:**
- Valid plan passes all checks and transitions to `await_plan_review` or `execute`.
- Plan with 0 steps is rejected.
- Plan with 21+ steps is rejected.
- Plan step referencing unregistered tool is rejected.
- `file_patch` step missing anchor is rejected.
- Step with Zod-invalid params is rejected.
- Rejection transitions to `replan` (or whichever phase handles re-planning).

**Why it matters:** If validation is broken, malformed plans reach the executor and produce unpredictable tool calls or runtime errors with no structured recovery.

---

### P1-3 — Add tests for `json-repair.node.ts`

**Problem:** Zero tests for the JSON repair node, which is the error recovery path for all malformed LLM output across every node in the pipeline.

**File:** `src/modules/agents/nodes/json-repair.node.ts`

**What to test:**
- Valid JSON string passes through unchanged and replays the original phase.
- Truncated JSON is repaired and replays the original phase.
- JSON with trailing commas or unquoted keys is repaired.
- Completely unrecoverable input triggers `terminal_response` (fatal) phase.
- The `originalPhase` field in state is correctly used for replay routing.

**Why it matters:** This node is the fallback for every LLM call in the system. If it is broken, a single malformed LLM response can crash the entire agent session with no recovery.

---

### P1-4 — Add tests for `generator.node.ts`

**Problem:** Zero tests for the generator node, which synthesizes the final answer presented to the user.

**File:** `src/modules/agents/nodes/generator.node.ts`

**What to test:**
- Given normalized tool results and context, produces a coherent final answer string.
- Uses vector memory search results when available.
- Transitions to `complete` phase after generation.
- Malformed LLM output routes to `json_repair`.
- Result is upserted to Qdrant via `upsertVectorMemory()` after successful generation.

**Why it matters:** The generator is the last substantive node before the user receives a response. A bug here produces corrupted or empty answers.

---

### P1-5 — Increase `llm.provider.ts` coverage from 63%

**Problem:** The LLM provider handles AbortController timeouts, exponential backoff, result caching (SHA256 → Redis), and error propagation. At 63% coverage, significant error branches are untested.

**File:** `src/modules/llm/llm.provider.ts` (and corresponding spec)

**What to add:**
- Timeout path: mock AbortController to fire before response, assert error is thrown.
- Cache hit path: pre-seed Redis mock with a SHA256 key, assert `invokeLlm()` returns cached value without calling Mistral.
- Cache miss path: assert Mistral is called and result is written to Redis.
- Retry path: mock Mistral to fail N times then succeed, assert exponential backoff is applied.
- All retries exhausted: assert terminal error is thrown.

**Why it matters:** LLM calls are the most expensive and failure-prone operations. Untested retry and cache logic means outages are harder to diagnose.

---

## Medium Priority Improvements (P2)

Important gaps that do not block CI today but increase maintenance risk.

### P2-1 — Add tests for `chat.node.ts`

**Problem:** Zero tests for the conversational fast-path node.

**File:** `src/modules/agents/nodes/chat.node.ts`

**What to test:**
- Produces a response using `sessionMemory` context without invoking the full agent pipeline.
- Calls `invokeLlm()` with the correct prompt.
- Transitions to `complete` after response.
- Handles empty `sessionMemory` gracefully.

**Why it matters:** The chat fast-path is the most frequently triggered path for simple conversational queries.

---

### P2-2 — Add tests for `tool-result-normalizer.node.ts`

**Problem:** Zero tests for the node that processes raw tool output before it reaches the critic and generator.

**File:** `src/modules/agents/nodes/tool-result-normalizer.node.ts`

**What to test:**
- Truncates oversized tool output to configured max length.
- Preserves structured output (JSON) vs. plain text output correctly.
- Error tool results (tool threw exception) are flagged appropriately in state.
- Transitions to `judge` phase after normalization.

**Why it matters:** Malformed or oversized tool results can cause downstream LLM context overflow or incorrect critic judgments.

---

### P2-3 — Add tests for `await-plan-review.node.ts`

**Problem:** Zero tests for the human-in-loop interrupt node.

**File:** `src/modules/agents/nodes/await-plan-review.node.ts`

**What to test:**
- `interrupt()` is called and suspends execution.
- `/approve` endpoint resumes with `execute` phase.
- `/reject` endpoint resumes with `terminal_response` phase.
- `/replan` endpoint resumes with `plan` phase.
- `REQUIRE_PLAN_REVIEW=false` env var skips the interrupt entirely.

**Why it matters:** Human-in-loop is a configurable safety gate. Broken interrupt handling silently bypasses or permanently blocks plan execution.

---

### P2-4 — Raise tool test coverage for zero-coverage tools

**Problem:** Six tools have 0% test coverage: `git_info`, `grep_search`, `generate_mermaid`, `edit_mermaid`, `ast_parse`, `glob_files`, `file_patch`.

**Files:**
- `src/modules/agents/tools/git-info.tool.ts`
- `src/modules/agents/tools/grep-search.tool.ts`
- `src/modules/agents/tools/generate-mermaid.tool.ts`
- `src/modules/agents/tools/edit-mermaid.tool.ts`
- `src/modules/agents/tools/ast-parse.tool.ts`
- `src/modules/agents/tools/glob-files.tool.ts`
- `src/modules/agents/tools/file-patch.tool.ts`

**Approach for each:** Write a spec that mocks the filesystem (or underlying library) and asserts:
1. Happy-path output matches expected shape.
2. `sandboxPath()` is called — paths outside the sandbox are rejected.
3. Tool timeout (`TOOL_TIMEOUT_MS`) is enforced.
4. Error result is returned (not thrown) on failure.

**Why it matters:** `file_patch` is especially critical — it modifies files on disk and is used in code generation tasks. A bug produces silent data corruption.

---

### P2-5 — Add tests for `vector-memory.util.ts`

**Problem:** Vector DB coverage is 21–52%. The utility functions `searchVectorMemories()` and `upsertVectorMemory()` are untested.

**File:** `src/modules/agents/utils/vector-memory.util.ts`

**What to test:**
- `searchVectorMemories()` returns ranked results from Qdrant mock.
- `searchVectorMemories()` returns empty array when Qdrant is unavailable (graceful degradation).
- `upsertVectorMemory()` encodes the payload and calls Qdrant upsert with correct collection name.
- `upsertVectorMemory()` handles Qdrant write failure without crashing the agent.
- Vector size mismatch (not matching `QDRANT_VECTOR_SIZE=384`) produces a clear error.

**Why it matters:** Vector memory powers long-term context across sessions. Silent Qdrant failures mean the agent loses memory without any error surfacing.

---

### P2-6 — Add tests for `prompt-context.util.ts`

**Problem:** `formatAttempts()` and `getAvailableTools()` are untested utility functions injected into every LLM prompt.

**File:** `src/modules/agents/utils/prompt-context.util.ts`

**What to test:**
- `formatAttempts()` formats an array of attempt objects into the expected string structure.
- `formatAttempts()` handles empty array (no prior attempts).
- `getAvailableTools()` returns only tools present in the tool registry.
- `getAvailableTools()` omits disabled or misconfigured tools.

**Why it matters:** Incorrectly formatted prompt context silently degrades LLM output quality across every node that uses these helpers.

---

### P2-7 — Add tests for `prompt-template.util.ts`

**Problem:** `renderPromptTemplate()` is used by all three prompt templates (supervisor.txt, planner.txt, critic.txt) but has no tests.

**File:** `src/modules/agents/utils/prompt-template.util.ts`

**What to test:**
- `{{variableName}}` placeholders are substituted correctly.
- Missing variable in data object leaves placeholder as-is (or throws — document the behavior).
- Nested/repeated placeholders are handled.
- Template with no placeholders returns the original string.

**Why it matters:** A broken template renderer silently sends malformed prompts to the LLM, producing nonsensical or dangerous outputs.

---

## Low Priority / Nice-to-Have (P3)

Minor improvements and future considerations that improve long-term maintainability.

### P3-1 — Add tests for `agent-state.helpers.ts`

**File:** `src/modules/agents/state/agent-state.helpers.ts`

**Functions to test:** `getAgentCounters()`, `incrementAgentCounters()`

Verify counter cap enforcement: `errors` caps at 20, `attempts` caps at 10, `toolCalls` caps at `turns × 5`, `replans` caps at `turns`, `stepRetries` caps at 3. These limits are enforced by the router — if the helpers return wrong values, the router makes wrong decisions.

---

### P3-2 — Improve `health` module coverage from 69%

**File:** `src/modules/health/health.controller.ts` (and related)

Add tests for failure cases: Redis unreachable, Qdrant unreachable, Mistral API unreachable. The health endpoint should return degraded status, not 500, for each.

---

### P3-3 — Document `REQUIRE_PLAN_REVIEW` behavior in ENV.md

**File:** `docs/ENV.md`

The `REQUIRE_PLAN_REVIEW=false` default silently bypasses the human-in-loop gate. Add a warning note explaining the security implication: with `false`, the agent can execute destructive file operations without human approval. Recommend setting to `true` in production deployments.

---

### P3-4 — Add integration smoke test for the full agent pipeline

**Problem:** No end-to-end test exercises the full `Supervisor → Researcher → Planner → Validator → Execute → Normalize → Critic → Router → Generator → Complete` path.

**Approach:** Create a LangGraph test harness that mocks `invokeLlm()` and all tool calls, then runs the compiled graph from `START` to `END` with a fixed input. Assert the terminal state has `phase = 'complete'` and a non-empty `finalAnswer`.

**Why it matters:** Unit tests on individual nodes do not catch routing regressions that only manifest when the full graph is compiled and executed.

---

### P3-5 — Enforce `sandboxPath()` in linting or CI

**Problem:** `sandboxPath()` must be called for all file tool operations, but this is documented only in CLAUDE.md with no automated enforcement.

**Approach:** Add a custom ESLint rule or a grep-based CI check that fails if any file in `src/modules/agents/tools/` reads from or writes to a path without calling `sandboxPath()`.

**Why it matters:** A single tool that skips `sandboxPath()` is a path traversal vulnerability that can read or write files outside the intended working directory.

---

## Test Coverage Roadmap

Prioritized by risk, effort, and impact. "Effort" is relative (S = <2h, M = 2–4h, L = 4–8h).

| Priority | File | Current Coverage | Target | Effort | Rationale |
|----------|------|-----------------|--------|--------|-----------|
| P0 | `nodes/supervisor.node.spec.ts` | Failing | Passing | S | 3 tests broken, blocks CI confidence |
| P0 | `nodes/decision-router.node.spec.ts` | Failing | Passing | S | Router test broken, terminal flow unvalidated |
| P1 | `nodes/planner.node.ts` | 0% | 80% | L | Critical path, highest plan-generation risk |
| P1 | `nodes/plan-validator.node.ts` | 0% | 80% | M | 8 validation rules, all untested |
| P1 | `nodes/json-repair.node.ts` | 0% | 80% | M | Error recovery for every LLM call |
| P1 | `nodes/generator.node.ts` | 0% | 80% | M | Final answer synthesis, vector upsert |
| P1 | `llm/llm.provider.ts` | 63% | 85% | M | Retry, cache, and timeout branches untested |
| P2 | `nodes/chat.node.ts` | 0% | 70% | S | Most frequent execution path |
| P2 | `nodes/tool-result-normalizer.node.ts` | 0% | 70% | S | Feeds critic and generator |
| P2 | `nodes/await-plan-review.node.ts` | 0% | 70% | M | Human-in-loop interrupt logic |
| P2 | `tools/file-patch.tool.ts` | 0% | 75% | M | Writes to disk, highest risk tool |
| P2 | `tools/git-info.tool.ts` | 0% | 70% | S | Low complexity, easy wins |
| P2 | `tools/grep-search.tool.ts` | 0% | 70% | S | Low complexity, easy wins |
| P2 | `tools/glob-files.tool.ts` | 0% | 70% | S | Low complexity, easy wins |
| P2 | `tools/ast-parse.tool.ts` | 0% | 70% | M | Parser edge cases need coverage |
| P2 | `tools/generate-mermaid.tool.ts` | 0% | 60% | S | Output validation only |
| P2 | `tools/edit-mermaid.tool.ts` | 0% | 60% | S | Output validation only |
| P2 | `utils/vector-memory.util.ts` | ~30% | 80% | M | Qdrant failure paths untested |
| P2 | `utils/prompt-context.util.ts` | 0% | 80% | S | Injected into every LLM prompt |
| P2 | `utils/prompt-template.util.ts` | 0% | 80% | S | Used by all 3 prompt templates |
| P3 | `state/agent-state.helpers.ts` | 0% | 80% | S | Counter cap logic used by router |
| P3 | `health/` | 69% | 85% | S | Failure/degraded cases missing |
| P3 | Full pipeline integration test | 0% | N/A | L | Smoke test for compiled graph |

**Estimated total effort to reach 75% overall coverage:** ~10–14 engineering days.
