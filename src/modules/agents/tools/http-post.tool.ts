import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { parseJsonHeaders, performHttpRequest } from './http-request.util';

const logger = new Logger('HttpPostTool');

export const httpPostTool = tool(
  async ({ url, body, headers }) => {
    logger.log(`POST request to: ${url}`);

    try {
      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(parseJsonHeaders(headers) ?? {}),
      };

      return performHttpRequest({
        url,
        method: 'POST',
        headers: requestHeaders,
        body,
      });
    } catch (error) {
      return `ERROR: ${(error as Error).message}`;
    }
  },
  {
    name: 'http_post',
    description:
      'Perform an HTTP POST request to a specific URL with a body (JSON string) and return the response. Requests are restricted by the outbound HTTP tool policy.',
    schema: z.object({
      url: z.string().url().describe('The valid URL to post to'),
      body: z.string().describe('The request body as a JSON string'),
      headers: z
        .string()
        .optional()
        .describe('Optional JSON string of request headers'),
    }),
  },
);
