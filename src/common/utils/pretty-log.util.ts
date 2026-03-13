import { inspect } from 'node:util';

/**
 * Pretty-prints any data (objects, JSON, strings) for logging with optional truncation.
 * Uses JSON.stringify(null, 2) for objects, util.inspect for complex types.
 */
export function prettyJson(data: unknown, maxLength: number = Infinity): string {
  if (data === null || data === undefined) return String(data);

  // Handle primitives
  if (typeof data !== 'object') return String(data);

  try {
    // Try JSON.stringify first for clean output
    let jsonStr = JSON.stringify(data, null, 2);

    // Truncate if too long
    if (jsonStr.length > maxLength && maxLength > 0) {
      const ellipsis = '…';
      jsonStr = jsonStr.slice(0, maxLength - ellipsis.length) + ellipsis;
    }

    return jsonStr;
  } catch {
    // Fallback to util.inspect for non-serializable objects
    return inspect(data, { colors: false, depth: 3, maxArrayLength: 10 });
  }
}

/**
 * Truncate string with preview ellipsis.
 */
export function preview(str: string, maxLength: number = 200): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '…';
}

