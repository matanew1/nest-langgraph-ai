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
 * Extract the first balanced JSON object from raw text.
 * Tracks brace depth and respects string boundaries, so it won't
 * greedily match from the first `{` to the last `}` in the entire string.
 */
function extractBalancedJson(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Attempt to extract a JSON object from a string that may contain
 * surrounding prose, markdown fences, or literal newlines inside string values.
 */
export function extractJson<T>(raw: string): T {
  const stagesTried: string[] = [];

  // 1. Try plain parse first (fastest path)
  stagesTried.push('plain parse');
  let result = tryParse<T>(raw);
  if (result !== undefined) return result;

  // 2. Fix literal newlines in JSON string values (common LLM issue)
  stagesTried.push('sanitize newlines');
  result = tryParse<T>(sanitizeJsonNewlines(raw));
  if (result !== undefined) return result;

  // 3. Strip markdown code fences and try again
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    stagesTried.push('strip markdown fences');
    const content = fenceMatch[1].trim();
    result = tryParse<T>(content) ?? tryParse<T>(sanitizeJsonNewlines(content));
    if (result !== undefined) return result;
  }

  // 4. Extract first balanced { … } substring (depth-aware, not greedy)
  const balanced = extractBalancedJson(raw);
  if (balanced) {
    stagesTried.push('balanced brace extraction');
    result =
      tryParse<T>(balanced) ??
      tryParse<T>(sanitizeJsonNewlines(balanced));
    if (result !== undefined) return result;
  }

  throw new SyntaxError(
    `Could not extract valid JSON from LLM response (stages tried: ${stagesTried.join(' -> ')}):\n${raw.slice(0, 300)}`,
  );
}
