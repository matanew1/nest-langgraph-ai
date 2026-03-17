describe('http-request.util', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.resetModules();
    jest.resetAllMocks();
    global.fetch = originalFetch;
  });

  function loadHttpUtil(mockEnv?: {
    httpToolAllowedHosts?: string;
    httpToolAllowPrivateNetworks?: boolean;
    httpToolMaxRedirects?: number;
  }) {
    const lookupMock = jest.fn();

    jest.doMock('node:dns/promises', () => ({
      lookup: lookupMock,
    }));
    jest.doMock('@config/env', () => ({
      env: {
        toolTimeoutMs: 5_000,
        httpToolAllowedHosts: mockEnv?.httpToolAllowedHosts ?? '',
        httpToolAllowPrivateNetworks:
          mockEnv?.httpToolAllowPrivateNetworks ?? false,
        httpToolMaxRedirects: mockEnv?.httpToolMaxRedirects ?? 3,
      },
    }));

    const util =
      require('./http-request.util') as typeof import('./http-request.util');
    return {
      ...util,
      lookupMock,
    };
  }

  it('parses JSON headers into a string record', () => {
    const { parseJsonHeaders } = loadHttpUtil();

    expect(parseJsonHeaders('{"X-Test":123}')).toEqual({ 'X-Test': '123' });
  });

  it('blocks localhost by default', async () => {
    const { performHttpRequest, lookupMock } = loadHttpUtil();
    global.fetch = jest.fn();

    const result = await performHttpRequest({
      url: 'http://localhost:3000/health',
      method: 'GET',
    });

    expect(result).toContain('blocked by the outbound HTTP policy');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('blocks hosts that resolve to private addresses', async () => {
    const { performHttpRequest, lookupMock } = loadHttpUtil();
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    global.fetch = jest.fn();

    const result = await performHttpRequest({
      url: 'https://internal.example.test/api',
      method: 'GET',
    });

    expect(result).toContain('resolves to a blocked address');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('enforces the optional host allowlist', async () => {
    const { performHttpRequest, lookupMock } = loadHttpUtil({
      httpToolAllowedHosts: 'api.example.com',
    });
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    global.fetch = jest.fn();

    const result = await performHttpRequest({
      url: 'https://example.org/data',
      method: 'GET',
    });

    expect(result).toContain('not allowed by HTTP_TOOL_ALLOWED_HOSTS');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('allows public hosts when they satisfy policy', async () => {
    const { performHttpRequest, lookupMock } = loadHttpUtil({
      httpToolAllowedHosts: 'api.example.com',
    });
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await performHttpRequest({
      url: 'https://api.example.com/data',
      method: 'GET',
    });

    expect(result).toContain('"ok": true');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('revalidates redirect targets before following them', async () => {
    const { performHttpRequest, lookupMock } = loadHttpUtil();
    lookupMock
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    global.fetch = jest.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1:8080/private' },
      }),
    );

    const result = await performHttpRequest({
      url: 'https://api.example.com/redirect',
      method: 'GET',
    });

    expect(result).toContain('blocked by the outbound HTTP policy');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
