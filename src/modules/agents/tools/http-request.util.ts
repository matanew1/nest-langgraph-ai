/**
 * Shared HTTP request utilities for http_get / http_post tools.
 * Includes an SSRF guard to block private network access unless explicitly allowed,
 * and a manual redirect follower that re-validates each hop against the SSRF guard.
 */
import { env } from '@config/env';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** IPv4/IPv6 ranges considered private or link-local. */
const PRIVATE_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./, // link-local
  /^::1$/,
  /^::ffff:127\./i,
  /^::ffff:10\./i,
  /^::ffff:172\.(1[6-9]|2\d|3[01])\./i,
  /^::ffff:192\.168\./i,
  /^::ffff:169\.254\./i,
  /^fc00:/i,
  /^fe80:/i,
];

/** Returns true when the host/address is private, loopback, or link-local. */
export function isPrivateHost(hostOrAddress: string): boolean {
  const h = hostOrAddress.toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0') return true;
  return PRIVATE_PATTERNS.some((re) => re.test(h));
}

async function resolveHostAddresses(host: string): Promise<string[]> {
  if (isIP(host)) {
    return [host];
  }

  const resolved = await lookup(host, { all: true, verbatim: true });
  return Array.from(
    new Set(resolved.map((entry) => entry.address.toLowerCase())),
  );
}

/**
 * Validates a URL against SSRF rules and the optional allowlist.
 *
 * @returns null when the request is allowed, or an error string when blocked.
 */
export async function checkHttpAllowed(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `Invalid URL: "${url}"`;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `Unsupported protocol "${parsed.protocol}". Only http/https are allowed.`;
  }

  const host = parsed.hostname.toLowerCase();

  if (!env.httpToolAllowPrivateNetworks && isPrivateHost(host)) {
    return (
      `Access to private/localhost host "${host}" is blocked. ` +
      `Set HTTP_TOOL_ALLOW_PRIVATE_NETWORKS=true to enable.`
    );
  }

  const allowlist = env.httpToolAllowedHosts;
  if (allowlist.length > 0) {
    const allowed = allowlist.some((pattern) => {
      const p = pattern.toLowerCase();
      if (p.startsWith('*.')) {
        // suffix match: *.openai.com matches api.openai.com and openai.com
        const suffix = p.slice(1); // ".openai.com"
        return host.endsWith(suffix) || host === suffix.slice(1);
      }
      return host === p;
    });
    if (!allowed) {
      return (
        `Host "${host}" is not in HTTP_TOOL_ALLOWED_HOSTS. ` +
        `Current allowlist: ${allowlist.join(', ') || '(empty)'}`
      );
    }
  }

  if (!env.httpToolAllowPrivateNetworks) {
    try {
      const addresses = await resolveHostAddresses(host);
      const privateAddress = addresses.find((address) => isPrivateHost(address));
      if (privateAddress) {
        return (
          `Host "${host}" resolves to private address "${privateAddress}", which is blocked. ` +
          `Set HTTP_TOOL_ALLOW_PRIVATE_NETWORKS=true to enable.`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Failed to resolve host "${host}": ${message}`;
    }
  }

  return null;
}

/** HTTP status codes that carry a Location redirect. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Follow redirects manually up to `env.httpToolMaxRedirects` hops.
 * Re-runs the SSRF guard on every redirect target so an attacker cannot
 * chain a public → private-network redirect to bypass the allowlist.
 *
 * For 303 and (301/302 on POST) the method is degraded to GET per RFC 7231.
 * 307/308 preserve the original method.
 *
 * @returns The final Response, or an error string if blocked / too many hops.
 */
export async function fetchWithRedirectLimit(
  url: string,
  init: RequestInit & { signal?: AbortSignal },
  method: 'GET' | 'POST' = 'GET',
): Promise<Response | string> {
  let currentUrl = url;
  let currentMethod = method;
  let currentBody = init.body;
  let hops = 0;
  const maxRedirects = env.httpToolMaxRedirects;

  while (true) {
    const response = await fetch(currentUrl, {
      ...init,
      method: currentMethod,
      body: currentBody,
      redirect: 'manual',
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    if (hops >= maxRedirects) {
      return `ERROR: Too many redirects (limit: ${maxRedirects}). Last URL: ${currentUrl}`;
    }

    const location = response.headers.get('location');
    if (!location) {
      // No Location header — treat as final response
      return response;
    }

    // Resolve relative redirects against the current URL
    try {
      currentUrl = new URL(location, currentUrl).toString();
    } catch {
      return `ERROR: Invalid redirect location "${location}"`;
    }

    // Re-check SSRF guard on the new target
    const guard = await checkHttpAllowed(currentUrl);
    if (guard) return `ERROR: Redirect target blocked — ${guard}`;

    // Downgrade method per RFC 7231 §6.4
    if (
      currentMethod === 'POST' &&
      (response.status === 301 || response.status === 302 || response.status === 303)
    ) {
      currentMethod = 'GET';
      currentBody = undefined;
    }

    hops++;
  }
}
