/**
 * Replace literal newlines inside JSON string values with their escape sequences.
 * LLMs frequently return JSON with unescaped newlines in string values,
 * which makes the JSON invalid for JSON.parse.
 */
function sanitizeJsonNewlines(text: string): string {
  return text.replace(/"(?:[^"\\]|\\.)*"/g, (match) =>
    match.replace(/\n/g, '\\n').replace(/\r/g, '\\r'),
  );
}

function tryParse<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/**
 * Attempt to extract a JSON object from a string that may contain
 * surrounding prose, markdown fences, or literal newlines inside string values.
 */
export function extractJson<T>(raw: string): T {
  // 1. Try plain parse first (fastest path)
  let result = tryParse<T>(raw);
  if (result !== undefined) return result;

  // 2. Fix literal newlines in JSON string values (common LLM issue)
  result = tryParse<T>(sanitizeJsonNewlines(raw));
  if (result !== undefined) return result;

  // 3. Strip markdown code fences and try again
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    const content = fenceMatch[1].trim();
    result = tryParse<T>(content) ?? tryParse<T>(sanitizeJsonNewlines(content));
    if (result !== undefined) return result;
  }

  // 4. Grab first { … } substring
  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    result =
      tryParse<T>(braceMatch[0]) ??
      tryParse<T>(sanitizeJsonNewlines(braceMatch[0]));
    if (result !== undefined) return result;
  }

  throw new SyntaxError(
    `Could not extract valid JSON from LLM response:\n${raw.slice(0, 1000)}`,
  );
}
