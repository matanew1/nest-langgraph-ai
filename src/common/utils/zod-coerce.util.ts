/**
 * Check whether a Zod schema node represents an array type (unwrapping
 * ZodOptional / ZodDefault / ZodNullable wrappers as needed).
 */
export function isZodArrayField(fieldSchema: unknown): boolean {
  if (!fieldSchema || typeof fieldSchema !== 'object') return false;
  const typeName = (fieldSchema as any)._def?.typeName as string | undefined;
  if (typeName === 'ZodArray') return true;
  if (
    typeName === 'ZodOptional' ||
    typeName === 'ZodDefault' ||
    typeName === 'ZodNullable'
  ) {
    return isZodArrayField(
      (fieldSchema as any)._def?.innerType ??
        (fieldSchema as any)._def?.type,
    );
  }
  return false;
}

/**
 * Coerce a raw string value to a string array.
 * Priority:
 *   1. JSON array literal
 *   2. File paths extracted from grep output (path:line: content)
 *   3. Non-empty lines
 */
export function coerceToStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed as string[];
  } catch {
    // not valid JSON, continue
  }
  // Extract unique file paths from grep output lines, e.g. "src/foo.ts:12: ..."
  const paths = new Set<string>();
  for (const line of value.split('\n')) {
    const m = line.match(/^([^\s:][^:]*\.\w+):\d+:/);
    if (m) paths.add(m[1].trim());
  }
  if (paths.size > 0) return Array.from(paths);
  // Fallback: split by newlines
  return value.split('\n').map((l) => l.trim()).filter(Boolean);
}
