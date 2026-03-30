# Tools Audit & Fixes Design

**Date:** 2026-03-31
**Scope:** All tool files in `src/modules/agents/tools/`
**Approach:** Option A — in-place fixes per file, no new shared abstractions

---

## Background

A full audit of 28 tool files revealed issues across six categories: critical security, logic bugs, missing error handling, input validation, boundary/size limits, and symlink safety. All fixes are self-contained within each tool file. No new shared utilities are introduced.

---

## Section 1 — Critical Security

### `run-command.tool.ts`
- **Problem:** Uses `exec()` which passes the command string through a shell, enabling injection (e.g., `ls; rm -rf /`). Also exposes all parent `process.env` secrets to the child process.
- **Fix:**
  - Replace `exec()` with `execFile('/bin/sh', ['-c', command])` — preserves shell features (pipes, redirects) while keeping args separated from the shell invocation.
  - Pass only a safe env whitelist to the child: `PATH`, `HOME`, `TMPDIR`, `LANG`, `USER`. Strip API keys and tokens.

---

## Section 2 — Logic Bugs

### `write-file.tool.ts`
- **Problem 1:** Code block regex `/```(?:\w*\n)?([\s\S]*?)```/` fails when lang tag has no trailing newline (e.g., ` ```ts` with content on next line).
- **Fix 1:** Change to `/```(?:\w*\n?)?([\s\S]*?)```/` — makes newline after lang tag optional.
- **Problem 2:** `mkdir` and `writeFile` calls have no try-catch — any permission or path error throws unhandled.
- **Fix 2:** Wrap both in try-catch; return error string on failure.

### `read-files-batch.tool.ts`
- **Problem 1:** Deduplication happens after slicing to `MAX_FILES`, so passing 50 identical paths wastes slots.
- **Fix 1:** Deduplicate with `[...new Set(paths)]` before slicing.
- **Problem 2:** Individual file read failures are silently skipped with no indication in output.
- **Fix 2:** On per-file failure, include an error note under that file's header in the output string.

### `file-patch.tool.ts`
- **Problem:** Occurrence scan uses `indexOf()` in a loop starting at `searchPos = idx + 1`. For short repeated strings in large files, this is O(n²).
- **Fix:** Add `MAX_OCCURRENCES = 1000` guard — after counting 1000 occurrences, break early and return an error indicating the pattern is too common to patch safely.

---

## Section 3 — Missing Error Handling

### `llm-summarize.tool.ts`
- Add `MAX_CONTENT = 100_000` chars check before calling `invokeLlm()`. If exceeded, truncate with a notice.
- Wrap `invokeLlm()` call in try-catch; return error string on failure.

### `vector-upsert.tool.ts`
- Wrap `upsertVectorMemory()` in try-catch.
- After call succeeds, validate result does not contain an error field before returning success message.

### `vector-search.tool.ts`
- Wrap `searchVectorMemories()` in try-catch.
- Return error string on failure instead of propagating exception.

---

## Section 4 — Input Validation

### `grep-search.tool.ts`
- **Problem:** Pattern string is passed directly to `grep -e` without validation. An invalid regex causes grep to error; a catastrophic regex causes ReDoS.
- **Fix:** Before spawning grep, attempt `new RegExp(pattern)` in a try-catch. Return a clear error string if the pattern is invalid.

### `git-info.tool.ts`
- **Problem:** The `args` string is split and passed to `execFile` without sanitization. Shell metacharacters could still cause unexpected git behavior.
- **Fix:** Validate `args` against `/^[\w\s\-\./=@^~:]+$/` before splitting. Reject inputs containing shell metacharacters (`; | & $ ( ) { } < > \``).

### `http-post.tool.ts`
- **Problem:** Body schema uses `z.record(z.string(), z.unknown())` — allows non-serializable values (functions, symbols) that will fail `JSON.stringify()` silently.
- **Fix:** Change to `z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))`.

---

## Section 5 — Boundary / Size Limits

### `read-mermaid.tool.ts`
- Add `MAX_SIZE = 100_000` bytes cap. If file exceeds limit, truncate and append a truncation notice (same pattern as `read-file.tool.ts`).

### `ast-parse.tool.ts`
- Add `MAX_FILE_BYTES = 500_000` guard: read file size with `stat()` before parsing; return error if too large.
- Replace `as t.File` unsafe cast with a type guard: check `result.type === 'File'` before proceeding; return error string if not.

### `repo-impact-radar.tool.ts`
- Add per-file read timeout: wrap each `readFile()` call with a 500ms `AbortSignal` timeout.
- Add symlink check in `walkFiles()`: use `lstat()` and skip entries where `isSymbolicLink()` returns true.

---

## Section 6 — Symlink Safety & Edge Cases

### `glob-files.tool.ts`
- Use `lstat()` instead of `stat()` during directory walk; skip entries where `isSymbolicLink()` is true to prevent infinite loops on circular symlinks.

### `tree-dir.tool.ts`
- Same as `glob-files`: use `lstat()` and skip symlinks during recursive traversal.

### `move-file.tool.ts`
- Before calling `rename()`, check if destination already exists with `stat()`.
- If destination exists, return a clear warning message instead of silently overwriting or throwing an OS-dependent error.

### `generate-mermaid.tool.ts` & `edit-mermaid.tool.ts`
- Strengthen `isLikelyMermaid()` (in `mermaid.util.ts`) — after stripping fences, check that the first non-empty line starts with a known Mermaid diagram type keyword:
  `graph`, `flowchart`, `sequenceDiagram`, `classDiagram`, `stateDiagram`, `erDiagram`, `gantt`, `pie`, `gitGraph`, `mindmap`, `timeline`, `xychart`
- Return validation failure with a descriptive message if the LLM output doesn't match.

---

## Files Changed

| File | Section |
|------|---------|
| `run-command.tool.ts` | 1 |
| `write-file.tool.ts` | 2 |
| `read-files-batch.tool.ts` | 2 |
| `file-patch.tool.ts` | 2 |
| `llm-summarize.tool.ts` | 3 |
| `vector-upsert.tool.ts` | 3 |
| `vector-search.tool.ts` | 3 |
| `grep-search.tool.ts` | 4 |
| `git-info.tool.ts` | 4 |
| `http-post.tool.ts` | 4 |
| `read-mermaid.tool.ts` | 5 |
| `ast-parse.tool.ts` | 5 |
| `repo-impact-radar.tool.ts` | 5, 6 |
| `glob-files.tool.ts` | 6 |
| `tree-dir.tool.ts` | 6 |
| `move-file.tool.ts` | 6 |
| `generate-mermaid.tool.ts` | 6 |
| `edit-mermaid.tool.ts` | 6 |
| `mermaid.util.ts` | 6 |

**Total: 19 files**

---

## Out of Scope

- Hardcoded `SKIP_DIRS` / `MAX_DEPTH` / `STOP_WORDS` configuration (low severity, left for future iteration)
- LLM system prompt configurability in mermaid tools
- Race condition on concurrent `edit-mermaid` calls (requires distributed locking, separate concern)
- `delete-file` audit logging (operational concern, not a bug)
