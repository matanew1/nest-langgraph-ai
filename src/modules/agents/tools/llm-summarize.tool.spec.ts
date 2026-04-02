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
