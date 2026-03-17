import { DynamicStructuredTool } from '@langchain/core/tools';
import { invokeLlm } from '@llm/llm.provider';
import { z } from 'zod';
import { env } from '@config/env';

/**
 * llm_summarize — feed content to the LLM and get an AI-generated analysis back.
 *
 * Use this when the plan needs to *understand*, *summarize*, or *explain* gathered
 * content rather than just copying it.  The result can then be piped into
 * write_file via __PREVIOUS_RESULT__.
 *
 * Example plan step:
 *   {"tool":"llm_summarize","input":{"content":"__PREVIOUS_RESULT__","instruction":"Summarize each TypeScript file…"}}
 */
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
    const maxChars = env.promptMaxSummaryChars;
    const truncated =
      content.length > maxChars
        ? content.slice(0, maxChars) + '\n[...truncated]'
        : content;
    const prompt = `${instruction}\n\n---\n\n${truncated}`;
    return invokeLlm(prompt);
  },
});
