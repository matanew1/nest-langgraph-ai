/**
 * Security-focused tests for the http_get tool.
 *
 * Strategy: mock `@config/env` to control policy settings, then spy on the
 * global `fetch` and `node:dns/promises` lookup to avoid real network I/O.
 */

// ── Mock env BEFORE importing any module that reads it at import-time ────────
jest.mock('@config/env', () => ({
  env: {
    httpToolAllowedHosts: 'example.com',
    httpToolAllowPrivateNetworks: false,
    httpToolMaxRedirects: 3,
    toolTimeoutMs: 5_000,
  },
}));

// ── Mock DNS lookup so we never hit the real network ────────────────────────
jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(),
}));

import { lookup } from 'node:dns/promises';
import { env } from '@config/env';
import { httpGetTool } from '../tools/http-get.tool';

const mockedLookup = lookup as jest.MockedFunction<typeof lookup>;

// Helper: build a minimal Response-like object that satisfies the fetch API
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

describe('httpGetTool – security and behavioural tests', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');

    // Default: DNS resolves to a public IP
    mockedLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  // ── 1. Successful GET to an allowlisted host ────────────────────────────
  it('returns response body on a successful GET to an allowlisted host', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeFetchResponse({ body: 'Hello from example.com' }),
    );

    const result = await httpGetTool.invoke({ url: 'https://example.com/' });

    expect(result).toBe('Hello from example.com');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // ── 2. Host NOT in allowlist ────────────────────────────────────────────
  it('returns an ERROR when the host is not in the allowlist', async () => {
    const result = await httpGetTool.invoke({ url: 'https://notallowed.com/' });

    expect(result).toMatch(/^ERROR:/);
    expect(result).toContain('not allowed by HTTP_TOOL_ALLOWED_HOSTS');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ── 3a. Wildcard allowlist – matching subdomain passes ──────────────────
  it('allows a subdomain when the allowlist rule is a wildcard (*.example.com)', async () => {
    (env as any).httpToolAllowedHosts = '*.example.com';

    mockedLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as any);

    fetchSpy.mockResolvedValueOnce(
      makeFetchResponse({ body: 'API response' }),
    );

    const result = await httpGetTool.invoke({
      url: 'https://api.example.com/data',
    });

    expect(result).toBe('API response');

    (env as any).httpToolAllowedHosts = 'example.com';
  });

  // ── 3b. Wildcard allowlist – non-matching host is blocked ───────────────
  it('blocks a host that does not match the wildcard rule (*.example.com)', async () => {
    (env as any).httpToolAllowedHosts = '*.example.com';

    const result = await httpGetTool.invoke({ url: 'https://evil.com/' });

    expect(result).toMatch(/^ERROR:/);
    expect(result).toContain('not allowed by HTTP_TOOL_ALLOWED_HOSTS');
    expect(fetchSpy).not.toHaveBeenCalled();

    (env as any).httpToolAllowedHosts = 'example.com';
  });

  // ── 4. Private network IP blocked when flag is false ────────────────────
  // Note: the allowlist guard runs first, so we set allowedHosts='' (allow-all)
  // to isolate the private-network IP guard.
  it('blocks 192.168.x.x when HTTP_TOOL_ALLOW_PRIVATE_NETWORKS=false', async () => {
    (env as any).httpToolAllowedHosts = '';
    (env as any).httpToolAllowPrivateNetworks = false;

    const result = await httpGetTool.invoke({
      url: 'http://192.168.1.1/',
    });

    expect(result).toMatch(/^ERROR:/);
    expect(result).toContain('blocked by the outbound HTTP policy');
    expect(fetchSpy).not.toHaveBeenCalled();

    (env as any).httpToolAllowedHosts = 'example.com';
  });

  it('blocks 10.x.x.x when HTTP_TOOL_ALLOW_PRIVATE_NETWORKS=false', async () => {
    (env as any).httpToolAllowedHosts = '';
    (env as any).httpToolAllowPrivateNetworks = false;

    const result = await httpGetTool.invoke({ url: 'http://10.0.0.1/' });

    expect(result).toMatch(/^ERROR:/);
    expect(result).toContain('blocked by the outbound HTTP policy');
    expect(fetchSpy).not.toHaveBeenCalled();

    (env as any).httpToolAllowedHosts = 'example.com';
  });

  it('blocks 127.x.x.x (loopback) when HTTP_TOOL_ALLOW_PRIVATE_NETWORKS=false', async () => {
    (env as any).httpToolAllowedHosts = '';
    (env as any).httpToolAllowPrivateNetworks = false;

    const result = await httpGetTool.invoke({ url: 'http://127.0.0.1/' });

    expect(result).toMatch(/^ERROR:/);
    expect(result).toContain('blocked by the outbound HTTP policy');
    expect(fetchSpy).not.toHaveBeenCalled();

    (env as any).httpToolAllowedHosts = 'example.com';
  });

  // ── 5. Private network allowed when flag is true ─────────────────────────
  it('allows private IP when HTTP_TOOL_ALLOW_PRIVATE_NETWORKS=true', async () => {
    (env as any).httpToolAllowedHosts = ''; // empty → all hosts pass host policy
    (env as any).httpToolAllowPrivateNetworks = true;

    fetchSpy.mockResolvedValueOnce(
      makeFetchResponse({ body: 'internal service' }),
    );

    const result = await httpGetTool.invoke({ url: 'http://192.168.1.1/' });

    expect(result).toBe('internal service');

    (env as any).httpToolAllowedHosts = 'example.com';
    (env as any).httpToolAllowPrivateNetworks = false;
  });

  // ── 6. Redirect count exceeds max ────────────────────────────────────────
  it('returns an ERROR when redirects exceed HTTP_TOOL_MAX_REDIRECTS', async () => {
    (env as any).httpToolMaxRedirects = 2;

    // Each call returns a 301 redirect to the same destination
    mockedLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as any);

    const redirectResponse = makeFetchResponse({
      status: 301,
      statusText: 'Moved Permanently',
      headers: { location: 'https://example.com/page' },
    });

    // We need maxRedirects + 1 redirect responses to trigger the limit
    fetchSpy
      .mockResolvedValueOnce(redirectResponse)
      .mockResolvedValueOnce(redirectResponse)
      .mockResolvedValueOnce(redirectResponse);

    const result = await httpGetTool.invoke({ url: 'https://example.com/' });

    expect(result).toMatch(/^ERROR:/);
    expect(result).toContain('redirect limit');

    (env as any).httpToolMaxRedirects = 3;
  });

  // ── 7. Network error (DNS failure / connection refused) ──────────────────
  it('returns an ERROR gracefully on a network error', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('fetch failed: ECONNREFUSED'));

    const result = await httpGetTool.invoke({ url: 'https://example.com/' });

    expect(result).toMatch(/^ERROR:/);
    expect(result).toContain('ECONNREFUSED');
  });

  // ── 8. Empty HTTP_TOOL_ALLOWED_HOSTS → all hosts allowed ─────────────────
  it('allows any host when HTTP_TOOL_ALLOWED_HOSTS is empty', async () => {
    (env as any).httpToolAllowedHosts = '';

    mockedLookup.mockResolvedValue([
      { address: '1.2.3.4', family: 4 },
    ] as any);

    fetchSpy.mockResolvedValueOnce(
      makeFetchResponse({ body: 'open access' }),
    );

    const result = await httpGetTool.invoke({
      url: 'https://arbitrary-public-host.com/',
    });

    expect(result).toBe('open access');

    (env as any).httpToolAllowedHosts = 'example.com';
  });

  // ── 9. Response too large → truncated ────────────────────────────────────
  it('truncates the response body when it exceeds 50 000 characters', async () => {
    const bigBody = 'x'.repeat(60_000);

    fetchSpy.mockResolvedValueOnce(makeFetchResponse({ body: bigBody }));

    const result = await httpGetTool.invoke({ url: 'https://example.com/' });

    expect(result).toContain('[truncated]');
    expect(result.length).toBeLessThan(60_000);
  });

  // ── 10. Non-200 status code → error string ───────────────────────────────
  it('returns an ERROR string containing the status code for non-2xx responses', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeFetchResponse({ status: 404, statusText: 'Not Found', body: '' }),
    );

    const result = await httpGetTool.invoke({ url: 'https://example.com/' });

    expect(result).toMatch(/^ERROR:/);
    expect(result).toContain('404');
  });

  // ── 11. JSON response parsed and pretty-printed ──────────────────────────
  it('returns pretty-printed JSON when Content-Type is application/json', async () => {
    const payload = { hello: 'world', count: 42 };

    fetchSpy.mockResolvedValueOnce(
      makeFetchResponse({
        json: payload,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await httpGetTool.invoke({ url: 'https://example.com/' });

    expect(result).toContain('"hello": "world"');
    expect(result).toContain('"count": 42');
  });

  // ── 12. Hostname that resolves to a blocked (private) IP is blocked ──────
  it('blocks a public hostname that DNS-resolves to a private IP', async () => {
    (env as any).httpToolAllowPrivateNetworks = false;

    // Simulate SSRF: "public" name that resolves to an internal address
    mockedLookup.mockResolvedValue([
      { address: '10.0.0.5', family: 4 },
    ] as any);

    const result = await httpGetTool.invoke({ url: 'https://example.com/' });

    expect(result).toMatch(/^ERROR:/);
    expect(result).toContain('blocked address');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ── 13. Embedded credentials in URL are rejected ─────────────────────────
  it('rejects a URL that contains embedded credentials (user:pass@host)', async () => {
    const result = await httpGetTool.invoke({
      url: 'https://user:pass@example.com/',
    });

    expect(result).toMatch(/^ERROR:/);
    expect(result).toContain('credentials');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ── 14. Non-http(s) protocol is rejected ─────────────────────────────────
  it('rejects a non-http(s) protocol (file://)', async () => {
    // Zod schema validates .url() so we need to pass a syntactically valid URL
    // but one with a disallowed protocol — bypass Zod by invoking the underlying
    // performHttpRequest via a crafted URL that node:net URL accepts.
    // The tool schema enforces z.string().url(), which strips non-http schemes,
    // but we can still verify the guard by calling with a raw valid URL string.
    const result = await httpGetTool.invoke({
      url: 'ftp://example.com/file.txt',
    });

    // Either Zod rejects it as invalid URL (ZodError path) or the util rejects it
    expect(result).toMatch(/^ERROR:|invalid/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
