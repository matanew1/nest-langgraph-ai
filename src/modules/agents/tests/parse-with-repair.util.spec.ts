import { z } from 'zod';

jest.mock('@config/env', () => ({
  env: {
    mistralTimeoutMs: 5000,
    promptMaxAttempts: 5,
  },
}));

jest.mock('@llm/llm.provider', () => ({
  invokeLlm: jest.fn(),
}));

import { parseWithRepair } from '../nodes/parse-with-repair.util';
import { invokeLlm } from '@llm/llm.provider';

const schema = z.object({ status: z.enum(['ok', 'fail']) });
const desc = '{"status":"ok"|"fail"}';

describe('parseWithRepair', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns parsed object without LLM call when JSON is valid', async () => {
    const result = await parseWithRepair('{"status":"ok"}', schema, desc);
    expect(result).toEqual({ status: 'ok' });
    expect(invokeLlm).not.toHaveBeenCalled();
  });

  it('calls invokeLlm once and returns repaired result when first parse fails', async () => {
    (invokeLlm as jest.Mock).mockResolvedValue('{"status":"fail"}');
    const result = await parseWithRepair('not-json', schema, desc);
    expect(result).toEqual({ status: 'fail' });
    expect(invokeLlm).toHaveBeenCalledTimes(1);
  });

  it('throws when both attempts fail', async () => {
    (invokeLlm as jest.Mock).mockResolvedValue('still-not-json');
    await expect(parseWithRepair('not-json', schema, desc)).rejects.toThrow();
    expect(invokeLlm).toHaveBeenCalledTimes(1);
  });
});
