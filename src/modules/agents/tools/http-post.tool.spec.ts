import { z } from 'zod';

// We only need to test the schema here — no network call needed
import { httpPostTool } from './http-post.tool';

describe('httpPostTool schema', () => {
  it('rejects a body object containing a nested object value', () => {
    const schema = (httpPostTool as unknown as { schema: z.ZodTypeAny }).schema;
    const result = schema.safeParse({
      url: 'https://example.com',
      body: { nested: { deep: 'value' } },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a body object with only string/number/boolean/null values', () => {
    const schema = (httpPostTool as unknown as { schema: z.ZodTypeAny }).schema;
    const result = schema.safeParse({
      url: 'https://example.com',
      body: { name: 'alice', age: 30, active: true, note: null },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a plain string body', () => {
    const schema = (httpPostTool as unknown as { schema: z.ZodTypeAny }).schema;
    const result = schema.safeParse({
      url: 'https://example.com',
      body: '{"raw":"string"}',
    });
    expect(result.success).toBe(true);
  });
});
