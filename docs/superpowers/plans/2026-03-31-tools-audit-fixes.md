# Tools Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all bugs, security issues, missing error handling, and edge cases across 19 tool files so every tool is safe, correct, and self-contained.

**Architecture:** In-place fixes per file — no new shared abstractions. Each tool file is made independently correct: its own error handling, its own validation, its own guards. All 17 tasks are grouped by the 6 design sections and ordered so the most critical fixes come first.

**Tech Stack:** TypeScript, NestJS, LangChain tools (`@langchain/core/tools`), Zod, Node.js `fs/promises`, `child_process.execFile`

---

## File Map

| File | Action | What Changes |
|------|--------|-------------|
| `src/modules/agents/tools/run-command.tool.ts` | Modify | `exec` → `execFile`, clean child env |
| `src/modules/agents/tools/run-command.tool.spec.ts` | Modify | Update mock from `exec` → `execFile`, add env test |
| `src/modules/agents/tools/write-file.tool.ts` | Modify | Fix regex, add try-catch |
| `src/modules/agents/tools/write-file.tool.spec.ts` | Create | Tests for regex + error path |
| `src/modules/agents/tools/read-files-batch.tool.ts` | Modify | Dedup before slice, per-file error note |
| `src/modules/agents/tools/read-files-batch.tool.spec.ts` | Create | Tests for dedup + failure reporting |
| `src/modules/agents/tools/file-patch.tool.ts` | Modify | `MAX_OCCURRENCES` guard |
| `src/modules/agents/tools/file-patch.tool.spec.ts` | Create | Test for occurrence guard |
| `src/modules/agents/tools/llm-summarize.tool.ts` | Modify | `MAX_CONTENT` guard, try-catch |
| `src/modules/agents/tools/llm-summarize.tool.spec.ts` | Create | Tests for limit + error path |
| `src/modules/agents/tools/vector-upsert.tool.ts` | Modify | try-catch, result validation |
| `src/modules/agents/tools/vector-upsert.tool.spec.ts` | Create | Tests for error path |
| `src/modules/agents/tools/vector-search.tool.ts` | Modify | try-catch |
| `src/modules/agents/tools/vector-search.tool.spec.ts` | Create | Tests for error path |
| `src/modules/agents/tools/grep-search.tool.ts` | Modify | RegExp validation before grep |
| `src/modules/agents/tools/grep-search.tool.spec.ts` | Create | Tests for invalid pattern |
| `src/modules/agents/tools/git-info.tool.ts` | Modify | Shell metachar validation on `args` |
| `src/modules/agents/tools/git-info.tool.spec.ts` | Create | Tests for arg injection rejection |
| `src/modules/agents/tools/http-post.tool.ts` | Modify | Body schema restricted to JSON primitives |
| `src/modules/agents/tools/http-post.tool.spec.ts` | Create | Tests for schema rejection |
| `src/modules/agents/tools/read-mermaid.tool.ts` | Modify | `MAX_SIZE` cap + truncation |
| `src/modules/agents/tools/read-mermaid.tool.spec.ts` | Create | Tests for truncation |
| `src/modules/agents/tools/ast-parse.tool.ts` | Modify | `MAX_FILE_BYTES` guard + type guard |
| `src/modules/agents/tools/ast-parse.tool.spec.ts` | Create | Tests for file size guard |
| `src/modules/agents/tools/repo-impact-radar.tool.ts` | Modify | `lstat` symlink skip + per-file timeout |
| `src/modules/agents/tools/repo-impact-radar.tool.spec.ts` | Create | Tests for symlink skip |
| `src/modules/agents/tools/glob-files.tool.ts` | Modify | `lstat` symlink skip |
| `src/modules/agents/tools/glob-files.tool.spec.ts` | Create | Tests for symlink skip |
| `src/modules/agents/tools/tree-dir.tool.ts` | Modify | `lstat` symlink skip |
| `src/modules/agents/tools/tree-dir.tool.spec.ts` | Create | Tests for symlink skip |
| `src/modules/agents/tools/move-file.tool.ts` | Modify | Destination existence check |
| `src/modules/agents/tools/move-file.tool.spec.ts` | Create | Tests for destination conflict |
| `src/modules/agents/tools/mermaid.util.ts` | Modify | Strengthen `isLikelyMermaid` |
| `src/modules/agents/tools/mermaid.util.spec.ts` | Create | Tests for new keywords |

---

## Task 1: run-command — security (exec → execFile, clean env)

**Files:**
- Modify: `src/modules/agents/tools/run-command.tool.ts`
- Modify: `src/modules/agents/tools/run-command.tool.spec.ts`

- [ ] **Step 1: Update the spec to mock `execFile` and add an env isolation test**

Replace the entire content of `src/modules/agents/tools/run-command.tool.spec.ts`:

```typescript
const mockExecFile = jest.fn();

jest.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

jest.mock('@config/env', () => ({
  env: {
    toolTimeoutMs: 5000,
  },
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: (input: string) =>
    `/workspace/${input === '.' ? '' : input}`.replace(/\/$/, ''),
}));

import { runCommandTool } from './run-command.tool';

describe('runCommandTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('prefixes failing commands with ERROR so the agent treats them as failures', async () => {
    mockExecFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (
          error: NodeJS.ErrnoException | null,
          stdout: string,
          stderr: string,
        ) => void,
      ) => {
        callback(
          Object.assign(new Error('Command failed'), { code: 2 }),
          '',
          'tests failed',
        );
      },
    );

    const result = await runCommandTool.invoke({ command: 'npm test' });

    expect(result).toBe(
      'ERROR: Command exited with code 2\nSTDERR:\ntests failed',
    );
  });

  it('does not expose parent process env secrets to child', async () => {
    let capturedOptions: Record<string, unknown> = {};

    mockExecFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        options: Record<string, unknown>,
        callback: (error: null, stdout: string, stderr: string) => void,
      ) => {
        capturedOptions = options;
        callback(null, 'ok', '');
      },
    );

    process.env.SECRET_KEY = 'super-secret-token';
    await runCommandTool.invoke({ command: 'echo hello' });
    delete process.env.SECRET_KEY;

    const childEnv = capturedOptions.env as Record<string, string>;
    expect(childEnv).toBeDefined();
    expect(childEnv['SECRET_KEY']).toBeUndefined();
    expect(childEnv['PATH']).toBeDefined();
  });

  it('returns combined stdout on success', async () => {
    mockExecFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, 'hello world', '');
      },
    );

    const result = await runCommandTool.invoke({ command: 'echo hello world' });
    expect(result).toBe('hello world');
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails (mock mismatch expected)**

```bash
npx jest run-command.tool.spec.ts --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `mockExecFile` not called, existing tool still uses `exec`.

- [ ] **Step 3: Update `run-command.tool.ts` to use `execFile` and clean env**

Replace the entire file content:

```typescript
import { execFile } from 'node:child_process';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { sandboxPath } from '@utils/path.util';
import { env } from '@config/env';

const logger = new Logger('RunCommandTool');
const MAX_OUTPUT = 100_000; // 100 KB

/** Only these env vars are forwarded to child processes. */
const SAFE_ENV_KEYS = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'USER', 'LOGNAME', 'SHELL'];

function buildSafeEnv(): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key] !== undefined) safe[key] = process.env[key];
  }
  return safe;
}

export const runCommandTool = tool(
  async ({ command, cwd, timeout }) => {
    const resolvedCwd = sandboxPath(cwd ?? '.');
    const timeoutMs = timeout ?? env.toolTimeoutMs;

    logger.log(`Running: ${command} (cwd=${resolvedCwd})`);

    return new Promise<string>((resolve) => {
      execFile(
        '/bin/sh',
        ['-c', command],
        {
          cwd: resolvedCwd,
          timeout: timeoutMs,
          maxBuffer: MAX_OUTPUT,
          env: buildSafeEnv(),
        },
        (error, stdout, stderr) => {
          const combined = [
            stdout?.trim(),
            stderr?.trim() ? `STDERR:\n${stderr.trim()}` : '',
          ]
            .filter(Boolean)
            .join('\n')
            .slice(0, MAX_OUTPUT);

          if (error) {
            const exitCode = (
              error as NodeJS.ErrnoException & { code?: number }
            ).code ?? 1;
            resolve(
              `ERROR: Command exited with code ${exitCode}\n${combined || error.message}`,
            );
          } else {
            resolve(combined || '(command completed with no output)');
          }
        },
      );
    });
  },
  {
    name: 'run_command',
    description:
      'Run a shell command inside the agent working directory. Use for npm scripts, builds, tests, or any system command. Returns stdout and stderr combined.',
    schema: z.object({
      command: z
        .string()
        .describe('Shell command to execute (e.g. "npm test", "ls -la")'),
      cwd: z
        .string()
        .optional()
        .describe(
          'Subdirectory to run in, relative to the agent working directory (default: ".")',
        ),
      timeout: z
        .number()
        .optional()
        .describe('Timeout in milliseconds (default: TOOL_TIMEOUT_MS env var)'),
    }),
  },
);
```

- [ ] **Step 4: Run the spec to verify it passes**

```bash
npx jest run-command.tool.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agents/tools/run-command.tool.ts src/modules/agents/tools/run-command.tool.spec.ts
git commit -m "fix(tools): replace exec with execFile and strip secrets from child env in run_command"
```

---

## Task 2: write-file — fix regex and add try-catch

**Files:**
- Modify: `src/modules/agents/tools/write-file.tool.ts`
- Create: `src/modules/agents/tools/write-file.tool.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/agents/tools/write-file.tool.spec.ts`:

```typescript
const mockMkdir = jest.fn().mockResolvedValue(undefined);
const mockWriteFile = jest.fn().mockResolvedValue(undefined);

jest.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: (p: string) => `/workspace/${p}`,
}));

import { writeFileTool } from './write-file.tool';

describe('writeFileTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('extracts code from a fenced block that has no newline after lang tag', async () => {
    // ```ts<content> with no newline between tag and code
    const content = '```tsconst x = 1;```';
    await writeFileTool.invoke({ path: 'out.ts', content });
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/workspace/out.ts',
      'const x = 1;',
      'utf-8',
    );
  });

  it('returns an error string when writeFile throws (no unhandled rejection)', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('EACCES: permission denied'));
    const result = await writeFileTool.invoke({ path: 'readonly.ts', content: 'x' });
    expect(result).toMatch(/ERROR/);
    expect(result).toMatch(/EACCES/);
  });

  it('returns an error string when mkdir throws', async () => {
    mockMkdir.mockRejectedValueOnce(new Error('EPERM: not permitted'));
    const result = await writeFileTool.invoke({ path: 'bad/path.ts', content: 'x' });
    expect(result).toMatch(/ERROR/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest write-file.tool.spec.ts --no-coverage 2>&1 | tail -15
```

Expected: FAIL — first test fails (regex doesn't match), second test throws unhandled rejection.

- [ ] **Step 3: Update `write-file.tool.ts`**

Replace the code block extraction and write section:

```typescript
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { sandboxPath } from '@utils/path.util';

const logger = new Logger('WriteFileTool');

const MAX_CONTENT_SIZE = 10_000_000; // 10 MB guard against runaway LLM output

export const writeFileTool = tool(
  async ({ path, content }) => {
    if (content.length > MAX_CONTENT_SIZE) {
      return `ERROR: content is too large (${content.length} chars). Maximum allowed is ${MAX_CONTENT_SIZE} chars.`;
    }

    // If the LLM includes a markdown block, extract just the code.
    // The newline after the lang tag is optional: ```ts\n or ```ts (no newline).
    let finalContent = content;
    const codeBlockMatch = content.match(/```(?:\w*\n?)?([\s\S]*?)```/);
    if (codeBlockMatch?.[1]) {
      logger.log('Code block found, extracting content for write operation.');
      finalContent = codeBlockMatch[1].trim();
    }

    const resolved = sandboxPath(path);
    logger.log(`Writing file: ${resolved}`);

    try {
      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, finalContent, 'utf-8');
    } catch (err) {
      return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }

    return `File written successfully: ${resolved} (${finalContent.length} bytes)`;
  },
  {
    name: 'write_file',
    description:
      'Write or create a file on the filesystem with the given content (creates parent directories if needed)',
    schema: z.object({
      path: z.string().describe('Absolute or relative path to the file'),
      content: z.string().describe('Content to write to the file'),
    }),
  },
);
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest write-file.tool.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agents/tools/write-file.tool.ts src/modules/agents/tools/write-file.tool.spec.ts
git commit -m "fix(tools): fix code-block regex and add error handling in write_file"
```

---

## Task 3: read-files-batch — dedup before slice, report per-file failures

**Files:**
- Modify: `src/modules/agents/tools/read-files-batch.tool.ts`
- Create: `src/modules/agents/tools/read-files-batch.tool.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/agents/tools/read-files-batch.tool.spec.ts`:

```typescript
const mockReadFile = jest.fn();

jest.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: (p: string) => `/workspace/${p}`,
}));

import { readFilesBatchTool } from './read-files-batch.tool';

describe('readFilesBatchTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deduplicates paths before applying the MAX_FILES limit', async () => {
    // Pass 26 paths — 25 unique + 1 duplicate. After dedup=25, all 25 should be read.
    const paths = Array.from({ length: 25 }, (_, i) => `file${i}.ts`);
    paths.push('file0.ts'); // duplicate
    mockReadFile.mockResolvedValue('content');

    await readFilesBatchTool.invoke({ paths });

    // 25 unique paths → 25 readFile calls
    expect(mockReadFile).toHaveBeenCalledTimes(25);
  });

  it('includes an error note for files that cannot be read', async () => {
    mockReadFile.mockImplementation((p: string) => {
      if (p.includes('missing')) return Promise.reject(new Error('ENOENT'));
      return Promise.resolve('hello');
    });

    const result = await readFilesBatchTool.invoke({
      paths: ['good.ts', 'missing.ts'],
    });

    expect(result).toContain('=== good.ts ===');
    expect(result).toContain('=== missing.ts ===');
    expect(result).toMatch(/ERROR.*ENOENT/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest read-files-batch.tool.spec.ts --no-coverage 2>&1 | tail -15
```

Expected: FAIL — dedup test: only 25 paths max, duplicate not correctly handled; error test: missing file causes unhandled rejection.

- [ ] **Step 3: Update `read-files-batch.tool.ts`**

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { sandboxPath } from '@utils/path.util';

const MAX_FILES = 25;
const MAX_PER_FILE = 80_000;
const MAX_TOTAL = 400_000;

export const readFilesBatchTool = tool(
  async ({ paths }) => {
    // Deduplicate first, then cap — so identical paths don't waste slots
    const unique = Array.from(new Set(paths)).slice(0, MAX_FILES);
    const outputs: string[] = [];
    let total = 0;

    for (const p of unique) {
      const resolved = sandboxPath(p);
      let block: string;

      try {
        const content = await readFile(resolved, 'utf-8');
        const truncated = content.length > MAX_PER_FILE;
        const chunk = truncated ? content.slice(0, MAX_PER_FILE) : content;
        block = `=== ${p} ===\n${chunk}${truncated ? '\n… [truncated]' : ''}\n`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        block = `=== ${p} ===\nERROR: could not read file — ${msg}\n`;
      }

      total += block.length;
      if (total > MAX_TOTAL) {
        outputs.push('… [batch truncated: total output limit reached]');
        break;
      }
      outputs.push(block);
    }

    return outputs.join('\n');
  },
  {
    name: 'read_files_batch',
    description:
      'Read multiple files in one call (bounded). Returns a concatenated text with file headers.',
    schema: z.object({
      paths: z
        .array(z.string())
        .min(1)
        .max(MAX_FILES)
        .describe('List of file paths to read'),
    }),
  },
);
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest read-files-batch.tool.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agents/tools/read-files-batch.tool.ts src/modules/agents/tools/read-files-batch.tool.spec.ts
git commit -m "fix(tools): dedup paths before MAX_FILES cap and report per-file read failures in read_files_batch"
```

---

## Task 4: file-patch — MAX_OCCURRENCES guard

**Files:**
- Modify: `src/modules/agents/tools/file-patch.tool.ts`
- Create: `src/modules/agents/tools/file-patch.tool.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/agents/tools/file-patch.tool.spec.ts`:

```typescript
const mockReadFile = jest.fn();
const mockWriteFile = jest.fn().mockResolvedValue(undefined);

jest.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: (p: string) => `/workspace/${p}`,
}));

import { filePatchTool } from './file-patch.tool';

describe('filePatchTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns an error when the pattern appears more than MAX_OCCURRENCES times', async () => {
    // Build a string with 1001 occurrences of "x"
    const content = 'x\n'.repeat(1001);
    mockReadFile.mockResolvedValue(content);

    const result = await filePatchTool.invoke({
      path: 'large.ts',
      find: 'x',
      replace: 'y',
    });

    expect(result).toMatch(/too many occurrences|too common/i);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest file-patch.tool.spec.ts --no-coverage 2>&1 | tail -15
```

Expected: FAIL — current code reports "Pattern found 1001 times" which is a different message format (it just says count).

- [ ] **Step 3: Update `file-patch.tool.ts`**

Add `MAX_OCCURRENCES` constant and guard at the top of the occurrence-counting loop:

```typescript
import { readFile, writeFile } from 'node:fs/promises';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { sandboxPath } from '@utils/path.util';

const logger = new Logger('FilePatchTool');

/** Bail out if the pattern appears more than this many times to avoid O(n²) scans. */
const MAX_OCCURRENCES = 1000;

export const filePatchTool = tool(
  async ({ path, find, replace }) => {
    const resolved = sandboxPath(path);
    logger.log(
      `Patching "${resolved}": find ${find.length} chars → replace ${replace.length} chars`,
    );

    let content: string;
    try {
      content = await readFile(resolved, 'utf-8');
    } catch {
      return `ERROR: file "${path}" does not exist or cannot be read.`;
    }

    // Count occurrences; bail early if pattern is too common to patch safely
    let occurrenceCount = 0;
    let searchPos = 0;
    while (true) {
      const idx = content.indexOf(find, searchPos);
      if (idx === -1) break;
      occurrenceCount++;
      if (occurrenceCount > MAX_OCCURRENCES) {
        return JSON.stringify({
          ok: false,
          error: `Pattern appears more than ${MAX_OCCURRENCES} times — too common to patch safely. Provide more surrounding context.`,
        });
      }
      searchPos = idx + 1;
    }

    if (occurrenceCount === 0) {
      return JSON.stringify({
        ok: false,
        error: `Pattern not found in file`,
      });
    }
    if (occurrenceCount > 1) {
      return JSON.stringify({
        ok: false,
        error: `Pattern found ${occurrenceCount} times; provide more context to make it unique`,
      });
    }

    const updated = content.replace(find, replace);
    await writeFile(resolved, updated, 'utf-8');

    const linesChanged = find.split('\n').length;
    return `Patched "${path}" successfully (${linesChanged} line${linesChanged === 1 ? '' : 's'} affected).`;
  },
  {
    name: 'file_patch',
    description:
      'Find and replace text within a file. Safer than rewriting the whole file — only the matched section changes. The "find" string must match exactly.',
    schema: z.object({
      path: z.string().describe('Path to the file to patch'),
      find: z.string().describe('Exact text to find in the file'),
      replace: z.string().describe('Replacement text'),
    }),
  },
);
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest file-patch.tool.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 1 test passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agents/tools/file-patch.tool.ts src/modules/agents/tools/file-patch.tool.spec.ts
git commit -m "fix(tools): add MAX_OCCURRENCES guard to prevent O(n²) scan in file_patch"
```

---

## Task 5: llm-summarize — MAX_CONTENT guard and try-catch

**Files:**
- Modify: `src/modules/agents/tools/llm-summarize.tool.ts`
- Create: `src/modules/agents/tools/llm-summarize.tool.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/agents/tools/llm-summarize.tool.spec.ts`:

```typescript
const mockInvokeLlm = jest.fn();

jest.mock('@llm/llm.provider', () => ({
  invokeLlm: (...args: unknown[]) => mockInvokeLlm(...args),
}));

jest.mock('@config/env', () => ({
  env: { promptMaxSummaryChars: 50_000 },
}));

import { llmSummarizeTool } from './llm-summarize.tool';

describe('llmSummarizeTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns an error string when content exceeds MAX_CONTENT', async () => {
    const huge = 'x'.repeat(100_001);
    const result = await llmSummarizeTool.invoke({
      content: huge,
      instruction: 'summarize',
    });
    expect(result).toMatch(/ERROR.*too large/i);
    expect(mockInvokeLlm).not.toHaveBeenCalled();
  });

  it('returns an error string when invokeLlm throws', async () => {
    mockInvokeLlm.mockRejectedValueOnce(new Error('LLM circuit open'));
    const result = await llmSummarizeTool.invoke({
      content: 'some content',
      instruction: 'summarize',
    });
    expect(result).toMatch(/ERROR.*LLM circuit open/i);
  });

  it('returns LLM output on success', async () => {
    mockInvokeLlm.mockResolvedValueOnce('A nice summary.');
    const result = await llmSummarizeTool.invoke({
      content: 'some content',
      instruction: 'summarize',
    });
    expect(result).toBe('A nice summary.');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest llm-summarize.tool.spec.ts --no-coverage 2>&1 | tail -15
```

Expected: FAIL — no MAX_CONTENT check exists, LLM error propagates uncaught.

- [ ] **Step 3: Update `llm-summarize.tool.ts`**

```typescript
import { DynamicStructuredTool } from '@langchain/core/tools';
import { invokeLlm } from '@llm/llm.provider';
import { z } from 'zod';
import { env } from '@config/env';

/** Hard ceiling before even attempting the LLM call. */
const MAX_CONTENT = 100_000;

export const llmSummarizeTool = new DynamicStructuredTool({
  name: 'llm_summarize',
  description:
    'Feed raw content to the LLM and return an AI-generated summary or analysis. ' +
    'Use when you need to summarize, explain, or transform gathered text with LLM intelligence.',
  schema: z.object({
    content: z.string().describe('The raw text content to summarize / analyse'),
    instruction: z
      .string()
      .describe(
        'What to do with the content, e.g. "Summarize each TypeScript file in 2-3 sentences"',
      ),
  }),
  func: async ({ content, instruction }): Promise<string> => {
    if (content.length > MAX_CONTENT) {
      return `ERROR: content is too large (${content.length} chars). Maximum allowed is ${MAX_CONTENT} chars.`;
    }

    const maxChars = env.promptMaxSummaryChars;
    const truncated =
      content.length > maxChars
        ? content.slice(0, maxChars) + '\n[...truncated]'
        : content;
    const prompt = `${instruction}\n\n---\n\n${truncated}`;

    try {
      return await invokeLlm(prompt);
    } catch (err) {
      return `ERROR: LLM call failed — ${err instanceof Error ? err.message : String(err)}`;
    }
  },
});
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest llm-summarize.tool.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agents/tools/llm-summarize.tool.ts src/modules/agents/tools/llm-summarize.tool.spec.ts
git commit -m "fix(tools): add MAX_CONTENT guard and catch invokeLlm errors in llm_summarize"
```

---

## Task 6: vector-upsert — try-catch and result validation

**Files:**
- Modify: `src/modules/agents/tools/vector-upsert.tool.ts`
- Create: `src/modules/agents/tools/vector-upsert.tool.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/agents/tools/vector-upsert.tool.spec.ts`:

```typescript
const mockUpsert = jest.fn();

jest.mock('@vector-db/vector-memory.util', () => ({
  upsertVectorMemory: (...args: unknown[]) => mockUpsert(...args),
}));

import { vectorUpsertTool } from './vector-upsert.tool';

describe('vectorUpsertTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns an error string when upsertVectorMemory throws', async () => {
    mockUpsert.mockRejectedValueOnce(new Error('Qdrant unreachable'));
    const result = await vectorUpsertTool.invoke({ text: 'hello', id: '1' });
    expect(result).toMatch(/ERROR.*Qdrant unreachable/i);
  });

  it('returns an error when the result contains an error field', async () => {
    mockUpsert.mockResolvedValueOnce({ error: 'payload schema mismatch' });
    const result = await vectorUpsertTool.invoke({ text: 'hello', id: '1' });
    expect(result).toMatch(/ERROR.*payload schema mismatch/i);
  });

  it('returns ok:true JSON on success', async () => {
    mockUpsert.mockResolvedValueOnce({ id: '1', updated: true });
    const result = await vectorUpsertTool.invoke({ text: 'hello', id: '1' });
    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest vector-upsert.tool.spec.ts --no-coverage 2>&1 | tail -15
```

Expected: FAIL — throw propagates uncaught, result.error field not checked.

- [ ] **Step 3: Update `vector-upsert.tool.ts`**

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { upsertVectorMemory } from '@vector-db/vector-memory.util';

export const vectorUpsertTool = tool(
  async ({ text, id, metadata }) => {
    let result: Record<string, unknown>;
    try {
      result = await upsertVectorMemory({ text, id, metadata });
    } catch (err) {
      return `ERROR: vector upsert failed — ${err instanceof Error ? err.message : String(err)}`;
    }

    if (result && typeof result === 'object' && 'error' in result) {
      return `ERROR: vector upsert returned an error — ${String(result.error)}`;
    }

    return JSON.stringify({ ok: true, ...result }, null, 2);
  },
  {
    name: 'vector_upsert',
    description:
      'Create an embedding for text and upsert it into Qdrant for later semantic recall',
    schema: z
      .object({
        text: z.string().min(1),
        id: z.string().min(1).optional(),
        metadata: z
          .record(
            z.string(),
            z.union([z.string(), z.number(), z.boolean(), z.null()]),
          )
          .optional(),
      })
      .strict(),
  },
);
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest vector-upsert.tool.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agents/tools/vector-upsert.tool.ts src/modules/agents/tools/vector-upsert.tool.spec.ts
git commit -m "fix(tools): add error handling and result validation in vector_upsert"
```

---

## Task 7: vector-search — try-catch

**Files:**
- Modify: `src/modules/agents/tools/vector-search.tool.ts`
- Create: `src/modules/agents/tools/vector-search.tool.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/agents/tools/vector-search.tool.spec.ts`:

```typescript
const mockSearch = jest.fn();

jest.mock('@vector-db/vector-memory.util', () => ({
  searchVectorMemories: (...args: unknown[]) => mockSearch(...args),
}));

import { vectorSearchTool } from './vector-search.tool';

describe('vectorSearchTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns an error string when searchVectorMemories throws', async () => {
    mockSearch.mockRejectedValueOnce(new Error('Qdrant timeout'));
    const result = await vectorSearchTool.invoke({ query: 'auth middleware' });
    expect(result).toMatch(/ERROR.*Qdrant timeout/i);
  });

  it('returns ok:true JSON with results on success', async () => {
    mockSearch.mockResolvedValueOnce([{ id: '1', score: 0.9 }]);
    const result = await vectorSearchTool.invoke({ query: 'auth', topK: 1 });
    const parsed = JSON.parse(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.results).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest vector-search.tool.spec.ts --no-coverage 2>&1 | tail -15
```

Expected: FAIL — throw propagates uncaught.

- [ ] **Step 3: Update `vector-search.tool.ts`**

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { searchVectorMemories } from '@vector-db/vector-memory.util';

export const vectorSearchTool = tool(
  async ({ query, topK }) => {
    const effectiveTopK = topK ?? 5;

    let results: unknown;
    try {
      results = await searchVectorMemories(query, { topK: effectiveTopK });
    } catch (err) {
      return `ERROR: vector search failed — ${err instanceof Error ? err.message : String(err)}`;
    }

    return JSON.stringify({ ok: true, topK: effectiveTopK, results }, null, 2);
  },
  {
    name: 'vector_search',
    description: 'Search Qdrant using an embedding for semantic recall',
    schema: z
      .object({
        query: z.string().min(1),
        topK: z.number().int().min(1).max(50).optional(),
      })
      .strict(),
  },
);
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest vector-search.tool.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agents/tools/vector-search.tool.ts src/modules/agents/tools/vector-search.tool.spec.ts
git commit -m "fix(tools): catch searchVectorMemories errors in vector_search"
```

---

## Task 8: grep-search — validate regex pattern before spawning grep

**Files:**
- Modify: `src/modules/agents/tools/grep-search.tool.ts`
- Create: `src/modules/agents/tools/grep-search.tool.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/agents/tools/grep-search.tool.spec.ts`:

```typescript
const mockExecFile = jest.fn();

jest.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

jest.mock('@config/env', () => ({
  env: { agentWorkingDir: '/workspace', toolTimeoutMs: 5000 },
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: (p: string) => `/workspace/${p}`,
}));

import { grepSearchTool } from './grep-search.tool';

describe('grepSearchTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns an error string for an invalid regex pattern', async () => {
    const result = await grepSearchTool.invoke({ pattern: '[invalid' });
    expect(result).toMatch(/ERROR.*invalid.*pattern/i);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('spawns grep for a valid pattern', async () => {
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: (e: null, out: string, err: string) => void) => {
        cb(null, 'src/foo.ts:1:match', '');
      },
    );
    const result = await grepSearchTool.invoke({ pattern: 'foo' });
    expect(mockExecFile).toHaveBeenCalled();
    expect(result).toContain('match');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest grep-search.tool.spec.ts --no-coverage 2>&1 | tail -15
```

Expected: FAIL — invalid pattern still spawns grep.

- [ ] **Step 3: Add the pattern validation to `grep-search.tool.ts`**

Add this block immediately after the `async ({ pattern, path, glob }) => {` opening line, before anything else:

```typescript
    // Validate pattern is a valid regex before spawning grep
    try {
      new RegExp(pattern);
    } catch {
      return `ERROR: invalid regex pattern — ${pattern}`;
    }

    const resolved = sandboxPath(path ?? '.');
```

The full updated function:

```typescript
import { execFile } from 'node:child_process';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { sandboxPath } from '@utils/path.util';
import { env } from '@config/env';

const logger = new Logger('GrepSearchTool');

const MAX_OUTPUT = 50_000;

const EXCLUDE_DIRS = ['node_modules', 'dist', '.git', 'coverage'];

export const grepSearchTool = tool(
  async ({ pattern, path, glob }) => {
    // Validate pattern is a valid regex before spawning grep
    try {
      new RegExp(pattern);
    } catch {
      return `ERROR: invalid regex pattern — ${pattern}`;
    }

    const resolved = sandboxPath(path ?? '.');

    const args = ['-rn', '--color=never'];
    for (const dir of EXCLUDE_DIRS) {
      args.push(`--exclude-dir=${dir}`);
    }
    if (glob) args.push(`--include=${glob}`);
    args.push('-e', pattern, resolved);

    logger.log(`Searching: pattern="${pattern}" path="${resolved}" glob="${glob ?? '*'}"`);

    return new Promise<string>((resolve) => {
      execFile(
        'grep',
        args,
        { cwd: env.agentWorkingDir, timeout: env.toolTimeoutMs, maxBuffer: MAX_OUTPUT },
        (error, stdout, stderr) => {
          if (stdout && stdout.trim().length > 0) {
            const lines = stdout.trim().split('\n');
            const header = `Found ${lines.length} match${lines.length === 1 ? '' : 'es'}:\n`;
            resolve((header + stdout.trim()).slice(0, MAX_OUTPUT));
            return;
          }
          if (error && 'code' in error && error.code !== 1) {
            resolve(`ERROR: ${stderr || error.message}`.slice(0, MAX_OUTPUT));
          } else {
            resolve(`No matches found for pattern "${pattern}"`);
          }
        },
      );
    });
  },
  {
    name: 'grep_search',
    description:
      'Search for a text pattern across files in a directory. Returns matching lines with file paths and line numbers. Automatically excludes node_modules, dist, .git, and coverage directories.',
    schema: z.object({
      pattern: z.string().describe('Text or regex pattern to search for'),
      path: z.string().optional().describe('Directory to search in (default: project root ".")'),
      glob: z.string().optional().describe('File glob filter, e.g. "*.ts" or "*.json"'),
    }),
  },
);
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest grep-search.tool.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agents/tools/grep-search.tool.ts src/modules/agents/tools/grep-search.tool.spec.ts
git commit -m "fix(tools): validate regex pattern before spawning grep in grep_search"
```

---

## Task 9: git-info — validate args for shell metacharacters

**Files:**
- Modify: `src/modules/agents/tools/git-info.tool.ts`
- Create: `src/modules/agents/tools/git-info.tool.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/agents/tools/git-info.tool.spec.ts`:

```typescript
const mockExecFile = jest.fn();

jest.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

jest.mock('@config/env', () => ({
  env: { agentWorkingDir: '/workspace', toolTimeoutMs: 5000 },
}));

import { gitInfoTool } from './git-info.tool';

describe('gitInfoTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns an error for args containing shell metacharacters', async () => {
    const result = await gitInfoTool.invoke({ action: 'log', args: 'HEAD; rm -rf /' });
    expect(result).toMatch(/ERROR.*invalid.*arg/i);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects args with backtick injection', async () => {
    const result = await gitInfoTool.invoke({ action: 'show', args: '`whoami`' });
    expect(result).toMatch(/ERROR.*invalid.*arg/i);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('accepts a clean commit hash as args', async () => {
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: (e: null, out: string, err: string) => void) => {
        cb(null, 'commit abc123\nAuthor: ...', '');
      },
    );
    const result = await gitInfoTool.invoke({ action: 'show', args: 'abc123' });
    expect(mockExecFile).toHaveBeenCalled();
    expect(result).toContain('commit abc123');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest git-info.tool.spec.ts --no-coverage 2>&1 | tail -15
```

Expected: FAIL — metacharacters not rejected.

- [ ] **Step 3: Update `git-info.tool.ts`**

Add `SAFE_ARGS_RE` and validate `args` before calling `buildArgs`:

```typescript
import { execFile } from 'node:child_process';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { env } from '@config/env';

const logger = new Logger('GitInfoTool');

const MAX_OUTPUT = 50_000;

const ALLOWED_ACTIONS = ['status', 'log', 'diff', 'branch', 'show'] as const;
type GitAction = (typeof ALLOWED_ACTIONS)[number];

/** Only allow chars that git legitimately uses in refs and paths. */
const SAFE_ARGS_RE = /^[\w\s\-\./=@^~:]+$/;

/** Shell metacharacters that must never appear in args. */
const SHELL_META_RE = /[;|&$(){}\\`<>!#]/;

function buildArgs(action: GitAction, args: string): string[] {
  const extra = args.trim().split(/\s+/).filter(Boolean);
  switch (action) {
    case 'status': return ['status', '--short'];
    case 'log':    return ['log', '--oneline', '-20', ...extra];
    case 'diff':   return ['diff', ...(extra.length ? extra : ['HEAD'])];
    case 'branch': return ['branch', '-a'];
    case 'show':   return ['show', '--stat', ...(extra.length ? extra : ['HEAD'])];
  }
}

export const gitInfoTool = tool(
  async ({ action, args }) => {
    if (!ALLOWED_ACTIONS.includes(action as GitAction)) {
      return `ERROR: unknown action "${action}". Allowed: ${ALLOWED_ACTIONS.join(', ')}`;
    }

    const safeArgs = args ?? '';
    if (safeArgs.trim().length > 0) {
      if (SHELL_META_RE.test(safeArgs) || !SAFE_ARGS_RE.test(safeArgs)) {
        return `ERROR: invalid arg characters detected — only alphanumeric, spaces, and git-safe punctuation (- . / = @ ^ ~ :) are allowed`;
      }
    }

    const gitArgs = buildArgs(action as GitAction, safeArgs);
    logger.log(`git ${action}: git ${gitArgs.join(' ')}`);

    return new Promise<string>((resolve) => {
      execFile(
        'git',
        gitArgs,
        { cwd: env.agentWorkingDir, timeout: env.toolTimeoutMs, maxBuffer: MAX_OUTPUT },
        (error, stdout, stderr) => {
          if (error) {
            resolve(`ERROR: ${stderr || error.message}`.slice(0, MAX_OUTPUT));
          } else {
            resolve((stdout || '(no output)').slice(0, MAX_OUTPUT));
          }
        },
      );
    });
  },
  {
    name: 'git_info',
    description:
      'Query git repository information. Actions: status (working tree changes), log (recent commits), diff (show changes), branch (list branches), show (commit details).',
    schema: z.object({
      action: z.string().describe('One of: status, log, diff, branch, show'),
      args: z
        .string()
        .optional()
        .describe('Optional extra arguments (e.g. file path for diff, commit hash for show)'),
    }),
  },
);
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest git-info.tool.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agents/tools/git-info.tool.ts src/modules/agents/tools/git-info.tool.spec.ts
git commit -m "fix(tools): validate git args against shell metacharacters in git_info"
```

---

## Task 10: http-post — restrict body schema to JSON primitives

**Files:**
- Modify: `src/modules/agents/tools/http-post.tool.ts`
- Create: `src/modules/agents/tools/http-post.tool.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/agents/tools/http-post.tool.spec.ts`:

```typescript
import { z } from 'zod';

// We only need to test the schema here — no network call needed
import { httpPostTool } from './http-post.tool';

describe('httpPostTool schema', () => {
  it('rejects a body object containing a nested object value', () => {
    const schema = (httpPostTool as unknown as { schema: z.ZodTypeAny }).schema;
    const result = schema.safeParse({
      url: 'https://example.com',
      body: { nested: { deep: 'value' } },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a body object with only string/number/boolean/null values', () => {
    const schema = (httpPostTool as unknown as { schema: z.ZodTypeAny }).schema;
    const result = schema.safeParse({
      url: 'https://example.com',
      body: { name: 'alice', age: 30, active: true, note: null },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a plain string body', () => {
    const schema = (httpPostTool as unknown as { schema: z.ZodTypeAny }).schema;
    const result = schema.safeParse({
      url: 'https://example.com',
      body: '{"raw":"string"}',
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest http-post.tool.spec.ts --no-coverage 2>&1 | tail -15
```

Expected: FAIL — `z.unknown()` in body schema accepts nested objects.

- [ ] **Step 3: Update the body schema in `http-post.tool.ts`**

Change the `body` field in the schema from:

```typescript
      body: z
        .union([z.string(), z.record(z.string(), z.unknown())])
```

To:

```typescript
      body: z
        .union([
          z.string(),
          z.record(
            z.string(),
            z.union([z.string(), z.number(), z.boolean(), z.null()]),
          ),
        ])
```

The full updated schema block at the bottom of the file:

```typescript
  {
    name: 'http_post',
    description:
      'Make an HTTP POST request to a URL with a body and return the response. Blocked for private/localhost addresses by default.',
    schema: z.object({
      url: z.string().describe('Full URL to POST to (must start with http:// or https://)'),
      body: z
        .union([
          z.string(),
          z.record(
            z.string(),
            z.union([z.string(), z.number(), z.boolean(), z.null()]),
          ),
        ])
        .describe(
          'Request body — either a JSON string or a plain object with primitive values (auto-serialised)',
        ),
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe('Optional HTTP request headers as key-value pairs'),
      contentType: z
        .string()
        .optional()
        .describe('Content-Type header value (default: "application/json")'),
    }),
  },
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest http-post.tool.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agents/tools/http-post.tool.ts src/modules/agents/tools/http-post.tool.spec.ts
git commit -m "fix(tools): restrict http_post body schema to JSON-serializable primitives"
```

---

## Task 11: read-mermaid — add size cap

**Files:**
- Modify: `src/modules/agents/tools/read-mermaid.tool.ts`
- Create: `src/modules/agents/tools/read-mermaid.tool.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/agents/tools/read-mermaid.tool.spec.ts`:

```typescript
const mockReadFile = jest.fn();

jest.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: (p: string) => `/workspace/${p}`,
}));

import { readMermaidTool } from './read-mermaid.tool';

describe('readMermaidTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('truncates files larger than MAX_SIZE with a notice', async () => {
    const large = 'flowchart LR\n' + 'A --> B\n'.repeat(20_000); // > 100 KB
    mockReadFile.mockResolvedValue(large);

    const result = await readMermaidTool.invoke({ path: 'big.mmd' });

    expect(result.length).toBeLessThanOrEqual(100_010); // MAX_SIZE + notice overhead
    expect(result).toContain('[truncated]');
  });

  it('returns full content for files within size limit', async () => {
    const small = 'flowchart LR\nA --> B';
    mockReadFile.mockResolvedValue(small);

    const result = await readMermaidTool.invoke({ path: 'small.mmd' });
    expect(result).toBe(small);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest read-mermaid.tool.spec.ts --no-coverage 2>&1 | tail -15
```

Expected: FAIL — no truncation exists, large file returned in full.

- [ ] **Step 3: Update `read-mermaid.tool.ts`**

```typescript
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { sandboxPath } from '@utils/path.util';

const logger = new Logger('ReadMermaidTool');

const MAX_SIZE = 100_000; // 100 KB

export const readMermaidTool = tool(
  async ({ path }) => {
    if (extname(path).toLowerCase() !== '.mmd') {
      return 'ERROR: Mermaid file path must end with .mmd';
    }

    const resolved = sandboxPath(path);
    logger.log(`Reading Mermaid file: ${resolved}`);

    const content = await readFile(resolved, 'utf-8');

    if (content.length > MAX_SIZE) {
      return (
        content.slice(0, MAX_SIZE) +
        `\n… [truncated: file is ${content.length} chars, limit is ${MAX_SIZE}]`
      );
    }

    return content;
  },
  {
    name: 'read_mermaid',
    description: 'Read a Mermaid (.mmd) file and return its contents.',
    schema: z.object({
      path: z.string().describe('Path to a .mmd file'),
    }),
  },
);
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest read-mermaid.tool.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agents/tools/read-mermaid.tool.ts src/modules/agents/tools/read-mermaid.tool.spec.ts
git commit -m "fix(tools): add MAX_SIZE truncation to read_mermaid"
```

---

## Task 12: ast-parse — MAX_FILE_BYTES guard and type guard for Babel result

**Files:**
- Modify: `src/modules/agents/tools/ast-parse.tool.ts`
- Create: `src/modules/agents/tools/ast-parse.tool.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/agents/tools/ast-parse.tool.spec.ts`:

```typescript
const mockStatSync = jest.fn();
const mockReadFileSync = jest.fn();

jest.mock('node:fs', () => ({
  statSync: (...args: unknown[]) => mockStatSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: (p: string) => `/workspace/${p}`,
}));

import { astParseTool } from './ast-parse.tool';

describe('astParseTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns an error for files exceeding MAX_FILE_BYTES', async () => {
    mockStatSync.mockReturnValue({ size: 600_000 });
    const result = await astParseTool.invoke({ path: 'huge.ts' });
    expect(result).toMatch(/ERROR.*too large/i);
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest ast-parse.tool.spec.ts --no-coverage 2>&1 | tail -15
```

Expected: FAIL — no size check, `readFileSync` is called regardless.

- [ ] **Step 3: Update `ast-parse.tool.ts`**

Change the import of `readFileSync` to also import `statSync`, and update `extractAstChunks`:

Change this:

```typescript
import { readFileSync } from 'node:fs';
```

To:

```typescript
import { readFileSync, statSync } from 'node:fs';
```

Change the top of `extractAstChunks`:

```typescript
const MAX_FILE_BYTES = 500_000; // 500 KB

function extractAstChunks(path: string, maxChunks?: number): AstChunk[] {
  const fullPath = sandboxPath(path);

  const fileStat = statSync(fullPath);
  if (fileStat.size > MAX_FILE_BYTES) {
    throw new Error(
      `File is too large to parse (${fileStat.size} bytes). Maximum is ${MAX_FILE_BYTES} bytes.`,
    );
  }

  const code = readFileSync(fullPath, 'utf-8');
  const ext = fullPath.split('.').pop()?.toLowerCase() || '';

  if (!SUPPORTED_EXTENSIONS.includes(`.${ext}`)) {
    throw new Error(
      `Unsupported file type: ${ext}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`,
    );
  }

  const parseResult = parser.parse(code, {
    sourceType: 'module',
    plugins: [
      'typescript',
      'jsx',
      'decorators-legacy',
      'exportDefaultFrom',
      'exportNamespaceFrom',
    ],
    tokens: false,
    ranges: true,
  });

  // Type guard: ensure Babel returned a File node before traversal
  if (!parseResult || parseResult.type !== 'File') {
    throw new Error(`Babel parser did not return a File node for: ${path}`);
  }

  const ast = parseResult as t.File;
  // ... rest of function unchanged
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest ast-parse.tool.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 1 test passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agents/tools/ast-parse.tool.ts src/modules/agents/tools/ast-parse.tool.spec.ts
git commit -m "fix(tools): add MAX_FILE_BYTES guard and type guard for Babel result in ast_parse"
```

---

## Task 13: repo-impact-radar — symlink skip and per-file read timeout

**Files:**
- Modify: `src/modules/agents/tools/repo-impact-radar.tool.ts`
- Create: `src/modules/agents/tools/repo-impact-radar.tool.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/agents/tools/repo-impact-radar.tool.spec.ts`:

```typescript
const mockReaddir = jest.fn();
const mockLstat = jest.fn();
const mockReadFile = jest.fn();
const mockStat = jest.fn();

jest.mock('node:fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  lstat: (...args: unknown[]) => mockLstat(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  stat: (...args: unknown[]) => mockStat(...args),
}));

jest.mock('@config/env', () => ({
  env: { agentWorkingDir: '/workspace' },
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: () => '/workspace',
}));

import { repoImpactRadarTool } from './repo-impact-radar.tool';

describe('repoImpactRadarTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('skips symlinks during directory walk', async () => {
    mockReaddir.mockResolvedValue(['real.ts', 'link.ts']);
    mockLstat.mockImplementation((_p: string) => {
      if (_p.includes('link.ts')) {
        return Promise.resolve({ isDirectory: () => false, isFile: () => false, isSymbolicLink: () => true });
      }
      return Promise.resolve({ isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false, size: 10 });
    });
    mockStat.mockResolvedValue({ size: 10 });
    mockReadFile.mockResolvedValue('content');

    await repoImpactRadarTool.invoke({ objective: 'real', hints: ['real'] });

    // readFile should only be called for real.ts, not link.ts
    const readFileCalls = (mockReadFile as jest.Mock).mock.calls.map((c) => c[0] as string);
    expect(readFileCalls.some((p) => p.includes('link.ts'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest repo-impact-radar.tool.spec.ts --no-coverage 2>&1 | tail -15
```

Expected: FAIL — `walkFiles` uses `stat()` (follows symlinks), `link.ts` gets added to the file list.

- [ ] **Step 3: Update `repo-impact-radar.tool.ts`**

Change the import from `stat` to add `lstat`:

```typescript
import { readdir, readFile, stat, lstat } from 'node:fs/promises';
```

Update `walkFiles` to use `lstat` and skip symlinks:

```typescript
async function walkFiles(root: string, acc: string[]): Promise<void> {
  const entries = await readdir(root);
  for (const entry of entries) {
    const full = join(root, entry);
    const fileStat = await lstat(full); // lstat does NOT follow symlinks
    if (fileStat.isSymbolicLink()) continue; // skip symlinks to prevent infinite loops
    if (fileStat.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      await walkFiles(full, acc);
      continue;
    }
    if (fileStat.isFile()) {
      acc.push(full);
    }
  }
}
```

Also update `scoreContentMatches` to wrap each `readFile` with a per-file timeout using `AbortSignal`:

```typescript
async function scoreContentMatches(
  root: string,
  files: string[],
  signals: string[],
  scored: Map<string, ScoredMatch>,
): Promise<void> {
  for (const file of files) {
    if (!isTextFile(file)) continue;

    const rel = relative(root, file);

    let content: string;
    try {
      const fileStat = await stat(file);
      if (fileStat.size > MAX_FILE_BYTES) continue;
      // 500ms per-file timeout to prevent stalling on slow/large files
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 500);
      try {
        content = await readFile(file, { encoding: 'utf-8', signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    } catch {
      continue;
    }

    const lowered = content.toLowerCase();
    for (const signal of signals) {
      const normalizedSignal = signal.trim().toLowerCase();
      if (normalizedSignal.length < 3) continue;
      if (lowered.includes(normalizedSignal)) {
        addReason(scored, rel, 4, `content matched "${signal}"`);
      }
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest repo-impact-radar.tool.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 1 test passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agents/tools/repo-impact-radar.tool.ts src/modules/agents/tools/repo-impact-radar.tool.spec.ts
git commit -m "fix(tools): skip symlinks and add per-file read timeout in repo_impact_radar"
```

---

## Task 14: glob-files — symlink skip

**Files:**
- Modify: `src/modules/agents/tools/glob-files.tool.ts`
- Create: `src/modules/agents/tools/glob-files.tool.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/agents/tools/glob-files.tool.spec.ts`:

```typescript
const mockReaddir = jest.fn();
const mockLstat = jest.fn();

jest.mock('node:fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  lstat: (...args: unknown[]) => mockLstat(...args),
  stat: (...args: unknown[]) => mockLstat(...args), // alias for current code
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: (p: string) => `/workspace/${p === '.' ? '' : p}`.replace(/\/$/, ''),
}));

import { globFilesTool } from './glob-files.tool';

describe('globFilesTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not follow symlinks during walk', async () => {
    mockReaddir.mockResolvedValueOnce(['real.ts', 'link.ts']);
    mockLstat.mockImplementation((p: string) => {
      if (p.endsWith('link.ts')) {
        return Promise.resolve({ isDirectory: () => false, isFile: () => false, isSymbolicLink: () => true });
      }
      return Promise.resolve({ isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false });
    });

    const result = await globFilesTool.invoke({ root: '.', extensions: ['.ts'] });
    expect(result).toContain('real.ts');
    expect(result).not.toContain('link.ts');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest glob-files.tool.spec.ts --no-coverage 2>&1 | tail -15
```

Expected: FAIL — `stat` follows symlinks, `link.ts` included in output.

- [ ] **Step 3: Update `glob-files.tool.ts`**

Change import from `stat` to `lstat`:

```typescript
import { readdir, lstat } from 'node:fs/promises';
```

Update the `walk` function:

```typescript
async function walk(
  dir: string,
  extensions: Set<string>,
  maxResults: number,
  acc: string[],
): Promise<void> {
  if (acc.length >= maxResults) return;
  const entries = await readdir(dir);
  for (const entry of entries) {
    if (acc.length >= maxResults) return;
    const full = join(dir, entry);
    const s = await lstat(full); // lstat does NOT follow symlinks
    if (s.isSymbolicLink()) continue; // skip to prevent infinite loops
    if (s.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      await walk(full, extensions, maxResults, acc);
    } else if (s.isFile()) {
      const dot = entry.lastIndexOf('.');
      const ext = dot >= 0 ? entry.slice(dot).toLowerCase() : '';
      if (extensions.size === 0 || extensions.has(ext)) acc.push(full);
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest glob-files.tool.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 1 test passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agents/tools/glob-files.tool.ts src/modules/agents/tools/glob-files.tool.spec.ts
git commit -m "fix(tools): use lstat to skip symlinks in glob_files"
```

---

## Task 15: tree-dir — symlink skip

**Files:**
- Modify: `src/modules/agents/tools/tree-dir.tool.ts`
- Create: `src/modules/agents/tools/tree-dir.tool.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/agents/tools/tree-dir.tool.spec.ts`:

```typescript
const mockReaddir = jest.fn();
const mockStat = jest.fn();

jest.mock('node:fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  lstat: (...args: unknown[]) => mockStat(...args), // alias
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: (p: string) => p,
}));

import { treeDirTool } from './tree-dir.tool';

describe('treeDirTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('skips symlinks and does not recurse into them', async () => {
    // Root stat: it's a directory
    mockStat
      .mockResolvedValueOnce({ isDirectory: () => true, isSymbolicLink: () => false }) // root
      .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true, isSymbolicLink: () => true }) // link.ts
      .mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false }); // real.ts

    mockReaddir.mockResolvedValueOnce(['link.ts', 'real.ts']);

    const result = await treeDirTool.invoke({ path: '/workspace' });

    expect(result).toContain('real.ts');
    expect(result).not.toContain('link.ts');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest tree-dir.tool.spec.ts --no-coverage 2>&1 | tail -15
```

Expected: FAIL — `stat` follows symlinks, `link.ts` shown in tree.

- [ ] **Step 3: Update `tree-dir.tool.ts`**

Change import: add `lstat` alongside `stat`:

```typescript
import { readdir, stat, lstat } from 'node:fs/promises';
```

Update `buildTree` to use `lstat` and skip symlinks:

```typescript
    let s;
    try {
      s = await lstat(fullPath); // lstat does NOT follow symlinks
    } catch {
      lines.push(`${prefix}${connector}${name} [unreadable]`);
      continue;
    }

    if (s.isSymbolicLink()) {
      // Skip symlinks to prevent infinite loops on circular references
      continue;
    }

    if (s.isDirectory()) {
      lines.push(`${prefix}${connector}${name}/`);
      if (!SKIP_DIRS.has(name)) {
        const children = await buildTree(fullPath, childPrefix, depth + 1);
        lines.push(...children);
      }
    } else {
      lines.push(`${prefix}${connector}${name}`);
    }
```

Keep the existing `stat` import for the top-level directory validation in `treeDirTool` (checking if the root path is a directory) — only `buildTree` uses `lstat`.

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest tree-dir.tool.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 1 test passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agents/tools/tree-dir.tool.ts src/modules/agents/tools/tree-dir.tool.spec.ts
git commit -m "fix(tools): skip symlinks in tree_dir to prevent infinite loops"
```

---

## Task 16: move-file — destination existence check

**Files:**
- Modify: `src/modules/agents/tools/move-file.tool.ts`
- Create: `src/modules/agents/tools/move-file.tool.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/agents/tools/move-file.tool.spec.ts`:

```typescript
const mockMkdir = jest.fn().mockResolvedValue(undefined);
const mockRename = jest.fn().mockResolvedValue(undefined);
const mockStat = jest.fn();

jest.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  rename: (...args: unknown[]) => mockRename(...args),
  stat: (...args: unknown[]) => mockStat(...args),
}));

jest.mock('@utils/path.util', () => ({
  sandboxPath: (p: string) => `/workspace/${p}`,
}));

import { moveFileTool } from './move-file.tool';

describe('moveFileTool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns a warning when the destination already exists', async () => {
    mockStat.mockResolvedValue({ isFile: () => true }); // destination exists

    const result = await moveFileTool.invoke({ from: 'src.ts', to: 'dest.ts' });

    expect(result).toMatch(/already exists/i);
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('proceeds with rename when destination does not exist', async () => {
    mockStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const result = await moveFileTool.invoke({ from: 'src.ts', to: 'dest.ts' });

    expect(mockRename).toHaveBeenCalled();
    expect(result).toContain('Moved');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest move-file.tool.spec.ts --no-coverage 2>&1 | tail -15
```

Expected: FAIL — no destination existence check, `rename` is called unconditionally.

- [ ] **Step 3: Update `move-file.tool.ts`**

```typescript
import { rename, mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { sandboxPath } from '@utils/path.util';

const logger = new Logger('MoveFileTool');

export const moveFileTool = tool(
  async ({ from, to }) => {
    const resolvedFrom = sandboxPath(from);
    const resolvedTo = sandboxPath(to);

    // Warn if destination already exists to prevent silent overwrites
    try {
      await stat(resolvedTo);
      return `ERROR: destination "${to}" already exists. Delete or rename it first.`;
    } catch (err) {
      // ENOENT means destination does not exist — that's what we want
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        return `ERROR: could not check destination — ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    logger.log(`Moving: ${resolvedFrom} → ${resolvedTo}`);

    try {
      await mkdir(dirname(resolvedTo), { recursive: true });
      await rename(resolvedFrom, resolvedTo);
      return `Moved: ${resolvedFrom} → ${resolvedTo}`;
    } catch (err) {
      return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: 'move_file',
    description:
      'Move or rename a file or directory. Creates destination parent directories if needed. Returns an error if the destination already exists.',
    schema: z.object({
      from: z.string().describe('Source path (file or directory to move/rename)'),
      to: z.string().describe('Destination path'),
    }),
  },
);
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest move-file.tool.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agents/tools/move-file.tool.ts src/modules/agents/tools/move-file.tool.spec.ts
git commit -m "fix(tools): check destination existence before rename in move_file"
```

---

## Task 17: mermaid.util — strengthen isLikelyMermaid

**Files:**
- Modify: `src/modules/agents/tools/mermaid.util.ts`
- Create: `src/modules/agents/tools/mermaid.util.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/agents/tools/mermaid.util.spec.ts`:

```typescript
import { isLikelyMermaid } from './mermaid.util';

describe('isLikelyMermaid', () => {
  it('accepts all known Mermaid diagram type keywords', () => {
    const validDiagrams = [
      'flowchart LR\nA --> B',
      'graph TD\nA --> B',
      'sequenceDiagram\nAlice->>Bob: Hello',
      'classDiagram\nclass Animal',
      'stateDiagram-v2\n[*] --> Active',
      'erDiagram\nCUSTOMER ||--o{ ORDER : places',
      'gantt\ntitle A Gantt Diagram',
      'pie title Pets\n"Dogs" : 386',
      'gitGraph\ncommit',
      'mindmap\nroot((mindmap))',
      'timeline\ntitle History',
      'xychart-beta\nxAxis [jan, feb]',
    ];
    for (const diagram of validDiagrams) {
      expect(isLikelyMermaid(diagram)).toBe(true);
    }
  });

  it('rejects non-Mermaid text', () => {
    expect(isLikelyMermaid('Hello world')).toBe(false);
    expect(isLikelyMermaid('const x = 1;')).toBe(false);
    expect(isLikelyMermaid('')).toBe(false);
  });

  it('returns false when only blank lines precede non-Mermaid content', () => {
    expect(isLikelyMermaid('\n\nconst x = 1;')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify some tests fail**

```bash
npx jest mermaid.util.spec.ts --no-coverage 2>&1 | tail -15
```

Expected: FAIL for `pie`, `gitGraph`, `mindmap`, `timeline`, `xychart-beta` — they are not in the current `isLikelyMermaid`.

- [ ] **Step 3: Update `isLikelyMermaid` in `mermaid.util.ts`**

Replace the `isLikelyMermaid` function:

```typescript
const MERMAID_DIAGRAM_KEYWORDS = [
  'flowchart',
  'graph',
  'sequenceDiagram',
  'stateDiagram',
  'classDiagram',
  'erDiagram',
  'gantt',
  'pie',
  'gitGraph',
  'mindmap',
  'timeline',
  'xychart',
  'journey',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
] as const;

export function isLikelyMermaid(text: string): boolean {
  // Find the first non-empty line and check if it starts with a known keyword
  const firstNonEmpty = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstNonEmpty) return false;
  return MERMAID_DIAGRAM_KEYWORDS.some((kw) => firstNonEmpty.startsWith(kw));
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx jest mermaid.util.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS — all tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/modules/agents/tools/mermaid.util.ts src/modules/agents/tools/mermaid.util.spec.ts
git commit -m "fix(tools): strengthen isLikelyMermaid to cover all Mermaid diagram types"
```

---

## Final: Run full test suite

- [ ] **Step 1: Run all tool tests**

```bash
npx jest src/modules/agents/tools --no-coverage 2>&1 | tail -30
```

Expected: All tests pass. Any failures indicate a regression introduced during a task — go back and fix the relevant task.

- [ ] **Step 2: Run full project test suite**

```bash
npm run test 2>&1 | tail -30
```

Expected: All tests pass.

- [ ] **Step 3: Final commit if any lint fixes needed**

```bash
npm run lint -- --fix
git add -p
git commit -m "fix(tools): lint cleanup after tools audit fixes"
```
