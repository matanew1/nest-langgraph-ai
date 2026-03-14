import { extractJson } from '../../../common/utils/json.util';

describe('extractJson', () => {
  it('parses plain JSON object', () => {
    const result = extractJson<{ status: string }>('{"status":"ok"}');
    expect(result.status).toBe('ok');
  });

  it('parses JSON with unescaped newlines in string values', () => {
    const raw = '{"message":"line1\nline2"}';
    const result = extractJson<{ message: string }>(raw);
    expect(result.message).toContain('line1');
  });

  it('strips markdown code fences', () => {
    const raw = '```json\n{"status":"plan_required"}\n```';
    const result = extractJson<{ status: string }>(raw);
    expect(result.status).toBe('plan_required');
  });

  it('extracts first {…} block from prose', () => {
    const raw =
      'Here is my response: {"status":"complete","summary":"done"} and nothing else.';
    const result = extractJson<{ status: string; summary: string }>(raw);
    expect(result.status).toBe('complete');
    expect(result.summary).toBe('done');
  });

  it('throws when no valid JSON can be found', () => {
    expect(() => extractJson('this is just plain text with no json')).toThrow(
      SyntaxError,
    );
  });

  it('parses nested objects', () => {
    const raw = '{"steps":[{"step_id":1,"tool":"search"}]}';
    const result = extractJson<{
      steps: Array<{ step_id: number; tool: string }>;
    }>(raw);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].tool).toBe('search');
  });
});
