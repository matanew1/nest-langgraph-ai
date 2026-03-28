import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { checkHttpAllowed, fetchWithRedirectLimit } from './http-request.util';
import { env } from '@config/env';

const logger = new Logger('HttpGetTool');
const MAX_RESPONSE_SIZE = 500_000; // 500 KB

export const httpGetTool = tool(
  async ({ url, headers }) => {
    const guard = checkHttpAllowed(url);
    if (guard) return `ERROR: ${guard}`;

    logger.log(`GET ${url}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.toolTimeoutMs);

    try {
      const result = await fetchWithRedirectLimit(
        url,
        {
          headers: {
            'User-Agent': 'nest-langgraph-ai/1.0',
            ...headers,
          },
          signal: controller.signal,
        },
        'GET',
      );

      if (typeof result === 'string') return result;

      const response = result;
      const text = await response.text();
      const body = text.slice(0, MAX_RESPONSE_SIZE);
      const truncated = text.length > MAX_RESPONSE_SIZE ? ' (truncated)' : '';
      return `HTTP ${response.status} ${response.statusText}${truncated}\n${body}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`GET ${url} failed: ${message}`);
      return `ERROR: ${message}`;
    } finally {
      clearTimeout(timer);
    }
  },
  {
    name: 'http_get',
    description:
      'Make an HTTP GET request to a URL and return the response body. Blocked for private/localhost addresses by default.',
    schema: z.object({
      url: z.string().describe('Full URL to fetch (must start with http:// or https://)'),
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe('Optional HTTP request headers as key-value pairs'),
    }),
  },
);
