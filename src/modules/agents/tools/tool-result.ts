import { z } from 'zod';

export type ToolResultKind = 'text' | 'json' | 'empty';

export const toolResultSchema = z
  .object({
    ok: z.boolean(),
    kind: z.enum(['text', 'json', 'empty']),
    summary: z.string(),
    /**
     * Safe preview for prompts/logs. Must be bounded and never huge.
     * For kind=json this is stringified JSON (bounded).
     */
    preview: z.string(),
    /**
     * Raw tool output as returned by the tool implementation.
     * Kept for debugging; may be truncated by executor before storage.
     */
    raw: z.string(),
    /**
     * Parsed JSON payload when kind=json and ok=true.
     * We keep it unknown so callers must validate further.
     */
    json: z.unknown().optional(),
    meta: z
      .object({
        tool: z.string(),
        durationMs: z.number().int().nonnegative().optional(),
        truncated: z.boolean().optional(),
      })
      .strict()
      .optional(),
    error: z
      .object({
        message: z.string(),
        code: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ToolResult = z.infer<typeof toolResultSchema>;

const ERROR_PREFIXES = ['ERROR', 'error:', 'Tool "'];

export function looksLikeToolError(text: string): boolean {
  const trimmed = text.trimStart();
  return ERROR_PREFIXES.some((p) => trimmed.startsWith(p));
}

function safePreview(text: string, maxChars: number): string {
  if (!text) return '(empty)';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n… [truncated: ${text.length} chars total]`;
}

function tryJsonParse(raw: string): unknown | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

export function toToolResult(args: {
  tool: string;
  raw: string;
  durationMs?: number;
  previewMaxChars?: number;
  rawMaxChars?: number;
}): ToolResult {
  const previewMaxChars = args.previewMaxChars ?? 4000;
  const rawMaxChars = args.rawMaxChars ?? 200_000;

  const originalRaw = args.raw ?? '';
  const truncated = originalRaw.length > rawMaxChars;
  const raw = truncated ? originalRaw.slice(0, rawMaxChars) : originalRaw;

  const empty = raw.trim().length === 0;
  if (empty) {
    return {
      ok: false,
      kind: 'empty',
      summary: 'Tool returned empty output.',
      preview: '(empty)',
      raw,
      meta: {
        tool: args.tool,
        durationMs: args.durationMs,
        truncated,
      },
      error: { message: 'Empty tool output' },
    };
  }

  const isError = looksLikeToolError(raw);
  if (isError) {
    return {
      ok: false,
      kind: 'text',
      summary: 'Tool returned an error.',
      preview: safePreview(raw, previewMaxChars),
      raw,
      meta: {
        tool: args.tool,
        durationMs: args.durationMs,
        truncated,
      },
      error: { message: safePreview(raw, 500) },
    };
  }

  const parsed = tryJsonParse(raw);
  if (parsed !== undefined) {
    const jsonPreview = safePreview(JSON.stringify(parsed, null, 2), previewMaxChars);
    return {
      ok: true,
      kind: 'json',
      summary: 'Tool returned JSON.',
      preview: jsonPreview,
      raw,
      json: parsed,
      meta: {
        tool: args.tool,
        durationMs: args.durationMs,
        truncated,
      },
    };
  }

  return {
    ok: true,
    kind: 'text',
    summary: 'Tool returned text.',
    preview: safePreview(raw, previewMaxChars),
    raw,
    meta: {
      tool: args.tool,
      durationMs: args.durationMs,
      truncated,
    },
  };
}

