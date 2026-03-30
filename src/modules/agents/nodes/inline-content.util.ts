const INLINE_NOT_FOUND = '__INLINE_CONTENT_MISSING__';

/**
 * Extract the first inline file content block from a user message.
 * Handles both [Attached: name] and [File: name] forms followed by a code fence.
 * Falls back to a sentinel value if no block is found.
 */
export function extractInlineContent(input: string): string {
  const match = input.match(
    /\[(?:Attached|File):[^\]]*\]\s*```(?:\w+)?\s*([\s\S]*?)```/,
  );
  return match ? match[1].trim() : INLINE_NOT_FOUND;
}

export { INLINE_NOT_FOUND };
