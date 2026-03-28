import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { checkHttpAllowed, fetchWithRedirectLimit } from './http-request.util';
import { env } from '@config/env';

const logger = new Logger('HttpPostTool');
const MAX_RESPONSE_SIZE = 500_000; // 500 KB

export const httpPostTool = tool(
  async ({ url, body, headers, contentType }) => {
    const guard = checkHttpAllowed(url);
    if (guard) return `ERROR: ${guard}`;

    const ct = contentType ?? 'application/json';
    const bodyStr =
      typeof body === 'string' ? body : JSON.stringify(body);

    logger.log(`POST ${url} (${ct}, ${bodyStr.length} bytes)`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.toolTimeoutMs);

    try {
      const result = await fetchWithRedirectLimit(
        url,
        {
          headers: {
            'Content-Type': ct,
            'User-Agent': 'nest-langgraph-ai/1.0',
            ...headers,
          },
          body: bodyStr,
          signal: controller.signal,
        },
        'POST',
      );

      if (typeof result === 'string') return result;

      const response = result;
      const text = await response.text();
      const responseBody = text.slice(0, MAX_RESPONSE_SIZE);
      const truncated = text.length > MAX_RESPONSE_SIZE ? ' (truncated)' : '';
      return `HTTP ${response.status} ${response.statusText}${truncated}\n${responseBody}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`POST ${url} failed: ${message}`);
      return `ERROR: ${message}`;
    } finally {
      clearTimeout(timer);
    }
  },
  {
    name: 'http_post',
    description:
      'Make an HTTP POST request to a URL with a body and return the response. Blocked for private/localhost addresses by default.',
    schema: z.object({
      url: z.string().describe('Full URL to POST to (must start with http:// or https://)'),
      body: z
        .union([z.string(), z.record(z.string(), z.unknown())])
        .describe('Request body — either a JSON string or a plain object (auto-serialised)'),
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe('Optional HTTP request headers as key-value pairs'),
      contentType: z
        .string()
        .optional()
        .describe('Content-Type header value (default: "application/json")'),
    }),
  },
);
