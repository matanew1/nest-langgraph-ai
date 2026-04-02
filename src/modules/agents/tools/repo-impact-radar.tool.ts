import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { readdir, readFile, stat, lstat } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
import { z } from 'zod';
import { env } from '@config/env';
import { sandboxPath } from '@utils/path.util';

const logger = new Logger('RepoImpactRadarTool');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);
const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.conf',
  '.css',
  '.env',
  '.graphql',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.sql',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'any',
  'are',
  'build',
  'change',
  'changes',
  'code',
  'create',
  'current',
  'feature',
  'file',
  'files',
  'fix',
  'for',
  'from',
  'how',
  'in',
  'into',
  'its',
  'make',
  'new',
  'not',
  'of',
  'or',
  'project',
  'related',
  'service',
  'system',
  'test',
  'tests',
  'that',
  'the',
  'this',
  'to',
  'update',
  'with',
]);
const MAX_FILE_BYTES = 200_000;

type ScoredMatch = {
  score: number;
  reasons: Set<string>;
};

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function splitCamelCase(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_.:/-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function deriveSignals(objective: string, hints: string[] = []): string[] {
  const signals: string[] = [];
  const seen = new Set<string>();

  const add = (candidate: string) => {
    const trimmed = candidate.trim();
    if (!trimmed) return;
    const normalized = normalizeToken(trimmed);
    if (normalized.length < 3 || STOP_WORDS.has(normalized) || seen.has(normalized))
      return;
    seen.add(normalized);
    signals.push(trimmed);
  };

  for (const hint of hints) {
    add(hint);
    for (const part of splitCamelCase(hint)) add(part);
  }

  const explicitPaths =
    objective.match(
      /(?:\.{0,2}\/)?[A-Za-z0-9_./@-]+\.[A-Za-z0-9_-]+/g,
    ) ?? [];
  for (const pathLike of explicitPaths) add(pathLike);

  const identifierTokens =
    objective.match(/[A-Za-z][A-Za-z0-9_./-]{2,}/g) ?? [];
  for (const token of identifierTokens) {
    add(token);
    for (const part of splitCamelCase(token)) add(part);
  }

  return signals.slice(0, 8);
}

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

function addReason(
  scoredMatches: Map<string, ScoredMatch>,
  path: string,
  score: number,
  reason: string,
): void {
  const current = scoredMatches.get(path) ?? {
    score: 0,
    reasons: new Set<string>(),
  };
  current.score += score;
  current.reasons.add(reason);
  scoredMatches.set(path, current);
}

function isTestFile(path: string): boolean {
  return /(^|\/)__tests__\/|\.spec\.|\.test\./i.test(path);
}

function isTextFile(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return ext === '' || TEXT_EXTENSIONS.has(ext);
}

async function scorePathMatches(
  root: string,
  files: string[],
  signals: string[],
): Promise<Map<string, ScoredMatch>> {
  const scored = new Map<string, ScoredMatch>();

  for (const file of files) {
    const rel = relative(root, file);
    const normalizedPath = normalizeToken(rel);
    const normalizedBase = normalizeToken(basename(rel, extname(rel)));

    for (const signal of signals) {
      const normalizedSignal = normalizeToken(signal);
      if (!normalizedSignal) continue;

      if (normalizedBase === normalizedSignal) {
        addReason(scored, rel, 12, `filename matched "${signal}"`);
        continue;
      }

      if (normalizedBase.includes(normalizedSignal)) {
        addReason(scored, rel, 9, `basename matched "${signal}"`);
      }

      if (normalizedPath.includes(normalizedSignal)) {
        addReason(scored, rel, 6, `path matched "${signal}"`);
      }
    }
  }

  return scored;
}

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
      content = await readFile(file, 'utf-8');
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

function formatMatches(
  label: string,
  entries: Array<[string, ScoredMatch]>,
  maxResults: number,
): string {
  if (entries.length === 0) return `## ${label}\n(none found)`;

  const lines = entries.slice(0, maxResults).map(([path, match], index) => {
    const reasons = Array.from(match.reasons).slice(0, 3).join('; ');
    return `${index + 1}. ${path} [score=${match.score}]${reasons ? ` — ${reasons}` : ''}`;
  });

  return `## ${label}\n${lines.join('\n')}`;
}

export const repoImpactRadarTool = tool(
  async ({ objective, hints, maxResults, includeTests }) => {
    const root = sandboxPath(env.agentWorkingDir);
    const signals = deriveSignals(objective, hints);

    logger.log(
      `Building repo impact radar for objective="${objective}" with ${signals.length} signal(s)`,
    );

    if (signals.length === 0) {
      return [
        `Impact radar for objective: ${objective}`,
        `Signals used: (none strong enough to score safely)`,
        `No likely files identified. Fall back to tree_dir or glob_files for broader discovery.`,
      ].join('\n');
    }

    const files: string[] = [];
    await walkFiles(root, files);

    const scored = await scorePathMatches(root, files, signals);
    await scoreContentMatches(root, files, signals, scored);

    const ranked = Array.from(scored.entries())
      .sort((a, b) => {
        if (b[1].score !== a[1].score) return b[1].score - a[1].score;
        return a[0].localeCompare(b[0]);
      })
      .filter(([, match]) => match.score > 0);

    const sourceEntries = ranked.filter(([path]) => !isTestFile(path));
    const testEntries = includeTests ? ranked.filter(([path]) => isTestFile(path)) : [];

    return [
      `Impact radar for objective: ${objective}`,
      `Signals used: ${signals.join(', ')}`,
      formatMatches('Likely source files', sourceEntries, maxResults),
      includeTests ? formatMatches('Likely tests', testEntries, maxResults) : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  },
  {
    name: 'repo_impact_radar',
    description:
      'Estimate which repository files and tests are most likely affected by a requested change. Read-only and useful for planning, impact analysis, and targeted test selection.',
    schema: z
      .object({
        objective: z
          .string()
          .min(1)
          .describe('Requested change or analysis objective'),
        hints: z
          .array(z.string().min(1))
          .max(8)
          .optional()
          .describe('Optional file paths, symbols, or keywords to bias scoring'),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .default(8)
          .describe('Maximum number of files to list per section'),
        includeTests: z
          .boolean()
          .optional()
          .default(true)
          .describe('Whether to include likely impacted test files'),
      })
      .strict(),
  },
);
