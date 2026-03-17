import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { env } from '@config/env';

const MAX_RESPONSE_CHARS = 50_000;
const SAFE_PROTOCOLS = new Set(['http:', 'https:']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SENSITIVE_REDIRECT_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
]);
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.google.internal.',
]);
const BLOCKED_IPS = new Set(['169.254.169.254', '100.100.100.200']);

function truncateResponseBody(body: string): string {
  return body.length > MAX_RESPONSE_CHARS
    ? `${body.slice(0, MAX_RESPONSE_CHARS)}\n...[truncated]`
    : body;
}

export function parseJsonHeaders(
  headers?: string,
): Record<string, string> | undefined {
  if (!headers) return undefined;

  const parsed = JSON.parse(headers) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Headers must be a JSON object');
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, String(value)]),
  );
}

function getAllowedHosts(): string[] {
  return env.httpToolAllowedHosts
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function matchesAllowedHost(hostname: string, rule: string): boolean {
  if (rule.startsWith('*.')) {
    const suffix = rule.slice(2);
    return hostname === suffix || hostname.endsWith(`.${suffix}`);
  }

  return hostname === rule || hostname.endsWith(`.${rule}`);
}

function isAllowedByHostPolicy(hostname: string): boolean {
  const allowedHosts = getAllowedHosts();
  if (allowedHosts.length === 0) return true;

  return allowedHosts.some((rule) => matchesAllowedHost(hostname, rule));
}

function ipv4ToNumber(address: string): number {
  return address
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .reduce((value, octet) => (value << 8) + octet, 0);
}

function isInIpv4Range(
  address: string,
  start: string,
  prefixLength: number,
): boolean {
  const mask =
    prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  const ip = ipv4ToNumber(address) >>> 0;
  const network = ipv4ToNumber(start) >>> 0;
  return (ip & mask) === (network & mask);
}

function isPrivateOrReservedIpv4(address: string): boolean {
  return (
    BLOCKED_IPS.has(address) ||
    isInIpv4Range(address, '0.0.0.0', 8) ||
    isInIpv4Range(address, '10.0.0.0', 8) ||
    isInIpv4Range(address, '100.64.0.0', 10) ||
    isInIpv4Range(address, '127.0.0.0', 8) ||
    isInIpv4Range(address, '169.254.0.0', 16) ||
    isInIpv4Range(address, '172.16.0.0', 12) ||
    isInIpv4Range(address, '192.0.0.0', 24) ||
    isInIpv4Range(address, '192.0.2.0', 24) ||
    isInIpv4Range(address, '192.168.0.0', 16) ||
    isInIpv4Range(address, '198.18.0.0', 15) ||
    isInIpv4Range(address, '198.51.100.0', 24) ||
    isInIpv4Range(address, '203.0.113.0', 24) ||
    isInIpv4Range(address, '224.0.0.0', 4) ||
    isInIpv4Range(address, '240.0.0.0', 4)
  );
}

function isPrivateOrReservedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') {
    return true;
  }

  if (normalized.startsWith('::ffff:')) {
    const mappedIpv4 = normalized.slice('::ffff:'.length);
    if (isIP(mappedIpv4) === 4) {
      return isPrivateOrReservedIpv4(mappedIpv4);
    }
  }

  const firstSegment = normalized.split(':')[0] || '0';
  const firstHextet = Number.parseInt(firstSegment, 16);

  return (
    (firstHextet & 0xfe00) === 0xfc00 ||
    (firstHextet & 0xffc0) === 0xfe80 ||
    (firstHextet & 0xff00) === 0xff00
  );
}

function isPrivateOrReservedIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateOrReservedIpv4(address);
  if (family === 6) return isPrivateOrReservedIpv6(address);
  return true;
}

function sanitizeRedirectHeaders(
  headers: Record<string, string> | undefined,
  currentUrl: URL,
  nextUrl: URL,
): Record<string, string> | undefined {
  if (!headers) return headers;
  if (currentUrl.hostname === nextUrl.hostname) return headers;

  return Object.fromEntries(
    Object.entries(headers).filter(
      ([key]) => !SENSITIVE_REDIRECT_HEADERS.has(key.toLowerCase()),
    ),
  );
}

async function assertHttpToolUrlAllowed(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  if (!SAFE_PROTOCOLS.has(url.protocol)) {
    throw new Error('Only http:// and https:// URLs are allowed');
  }

  if (url.username || url.password) {
    throw new Error('URLs with embedded credentials are not allowed');
  }

  const hostname = url.hostname.toLowerCase();
  if (!isAllowedByHostPolicy(hostname)) {
    throw new Error(
      `Host "${hostname}" is not allowed by HTTP_TOOL_ALLOWED_HOSTS`,
    );
  }

  if (env.httpToolAllowPrivateNetworks) {
    return url;
  }

  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error(
      `Host "${hostname}" is blocked by the outbound HTTP policy`,
    );
  }

  if (isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new Error(
        `IP address "${hostname}" is blocked by the outbound HTTP policy`,
      );
    }
    return url;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error(`Host "${hostname}" could not be resolved`);
  }

  const blockedAddress = addresses.find(({ address }) =>
    isPrivateOrReservedIp(address),
  );
  if (blockedAddress) {
    throw new Error(
      `Host "${hostname}" resolves to a blocked address (${blockedAddress.address})`,
    );
  }

  return url;
}

export async function performHttpRequest(args: {
  url: string;
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.toolTimeoutMs);
  let currentUrl = args.url;
  let method = args.method ?? 'GET';
  let body = args.body;
  let headers = args.headers;

  try {
    for (
      let redirectCount = 0;
      redirectCount <= env.httpToolMaxRedirects;
      redirectCount++
    ) {
      const validatedUrl = await assertHttpToolUrlAllowed(currentUrl);
      const response = await fetch(validatedUrl.toString(), {
        method,
        headers,
        body,
        signal: controller.signal,
        redirect: 'manual',
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        if (redirectCount === env.httpToolMaxRedirects) {
          return `ERROR: Request exceeded the redirect limit (${env.httpToolMaxRedirects})`;
        }

        const location = response.headers.get('location');
        if (!location) {
          return `ERROR: Redirect response missing Location header`;
        }

        const nextUrl = new URL(location, validatedUrl);
        headers = sanitizeRedirectHeaders(headers, validatedUrl, nextUrl);
        currentUrl = nextUrl.toString();

        if (response.status === 303 && method !== 'GET') {
          method = 'GET';
          body = undefined;
        }
        continue;
      }

      if (!response.ok) {
        return `ERROR: Request failed with status ${response.status} ${response.statusText}`;
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await response.json();
        return truncateResponseBody(JSON.stringify(data, null, 2));
      }

      return truncateResponseBody(await response.text());
    }

    return `ERROR: Request exceeded the redirect limit (${env.httpToolMaxRedirects})`;
  } catch (error) {
    if (controller.signal.aborted) {
      return `ERROR: Request timed out after ${env.toolTimeoutMs}ms`;
    }
    return `ERROR: ${(error as Error).message}`;
  } finally {
    clearTimeout(timer);
  }
}
