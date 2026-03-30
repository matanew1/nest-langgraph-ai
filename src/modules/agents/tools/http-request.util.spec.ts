const mockLookup = jest.fn();

jest.mock('@config/env', () => ({
  env: {
    httpToolAllowedHosts: [],
    httpToolAllowPrivateNetworks: false,
    httpToolMaxRedirects: 3,
  },
}));

jest.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => mockLookup(...args),
}));

import { checkHttpAllowed, fetchWithRedirectLimit } from './http-request.util';

describe('http-request.util', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('blocks hosts that resolve to a private address', async () => {
    mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    await expect(checkHttpAllowed('http://rebind.test')).resolves.toContain(
      'resolves to private address',
    );
  });

  it('allows hosts that resolve only to public addresses', async () => {
    await expect(checkHttpAllowed('https://example.com')).resolves.toBeNull();
  });

  it('re-validates redirect targets against the SSRF guard', async () => {
    mockLookup.mockImplementation(async (host: string) => {
      if (host === 'safe.test') {
        return [{ address: '93.184.216.34', family: 4 }];
      }
      return [{ address: '127.0.0.1', family: 4 }];
    });

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response('', {
          status: 302,
          headers: { location: 'http://rebind.test/private' },
        }),
      ) as any;

    const result = await fetchWithRedirectLimit(
      'http://safe.test/start',
      { signal: new AbortController().signal },
      'GET',
    );

    expect(result).toBe(
      'ERROR: Redirect target blocked — Host "rebind.test" resolves to private address "127.0.0.1", which is blocked. Set HTTP_TOOL_ALLOW_PRIVATE_NETWORKS=true to enable.',
    );
  });
});
