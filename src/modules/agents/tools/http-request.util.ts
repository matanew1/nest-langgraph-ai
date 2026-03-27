/**
 * Shared HTTP request utilities for http_get / http_post tools.
 * Includes an SSRF guard to block private network access unless explicitly allowed.
 */
import { env } from '@config/env';

/** IPv4/IPv6 ranges considered private or link-local. */
const PRIVATE_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./, // link-local
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

/** Returns true if the host resolves to a private/localhost address. */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0') return true;
  return PRIVATE_PATTERNS.some((re) => re.test(h));
}

/**
 * Validates a URL against SSRF rules and the optional allowlist.
 *
 * @returns null when the request is allowed, or an error string when blocked.
 */
export function checkHttpAllowed(url: string): string | null {
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

  return null;
}
