import { DynamicStructuredTool } from '@langchain/core/tools';
import { invokeLlm } from '@llm/llm.provider';
import { z } from 'zod';

/**
 * Extracts code from a string that might be wrapped in markdown fences.
 * @param content The string content from the LLM.
 * @returns The extracted code.
 */
function extractCode(content: string): string {
  const cleanContent = content.trim();
  // Regex to find content within triple backticks, with optional language identifier.
  const regex = /```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```/;
  const match = cleanContent.match(regex);

  // If a match is found, return the captured group (the code).
  return match ? match[1].trim() : cleanContent;
}

/**
 * llm_summarize — feed content to the LLM and get an AI-generated analysis or code back.
 *
 * Use this when the plan needs to *understand*, *summarize*, or *explain* gathered
 * content rather than just copying it.  The result can then be piped into
 * write_file via __PREVIOUS_RESULT__.
 *
 * Example plan step:
 *   {"tool":"llm_summarize","input":{"content":"__PREVIOUS_RESULT__","instruction":"Summarize each TypeScript file…"}}
 *
 * For code generation, set `outputType` to "code" and provide a clear instruction.
 *   {"tool":"llm_summarize","input":{"content":"...","instruction":"Merge these interfaces into a single file.","outputType":"code"}}
 */
export const llmSummarizeTool = new DynamicStructuredTool({
  name: 'llm_summarize',
  description:
    'Feed raw content to the LLM and return an AI-generated summary or analysis. ' +
    'Use when you need to summarize, explain, or transform gathered text with LLM intelligence. Can also be used for code generation.',
  schema: z.object({
    content: z.string().describe('The raw text content to summarize / analyse'),
    instruction: z
      .string()
      .describe(
        'What to do with the content, e.g. "Summarize each TypeScript file in 2-3 sentences"',
      ),
    outputType: z
      .enum(['text', 'code'])
      .optional()
      .default('text')
      .describe(
        'Set to "code" if you expect valid, runnable code as output. This will add stricter instructions and post-processing.',
      ),
  }),
  func: async ({ content, instruction, outputType }): Promise<string> => {
    const codePrompt =
      'Return ONLY the valid code. Do not include any introductory text, explanations, or Markdown code blocks (no ``` tags). The output must be ready to save directly to a file.';

    const prompt =
      outputType === 'code'
        ? `${instruction}\n\n${codePrompt}\n\n---\n\n${content}`
        : `${instruction}\n\n---\n\n${content}`;

    let result = await invokeLlm(prompt);

    if (outputType === 'code') {
      result = extractCode(result);
    }

    return result;
  },
});
