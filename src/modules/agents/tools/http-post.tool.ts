import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';

const logger = new Logger('HttpPostTool');

export const httpPostTool = tool(
  async ({ url, body, headers }) => {
    logger.log(`POST request to: ${url}`);

    try {
      // Ensure body is a string for fetch, but handle if the LLM passes an object (rare with strict schema but possible)
      const bodyContent = typeof body === 'string' ? body : JSON.stringify(body);
      
      // Parse headers if provided as a JSON string
      let requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (headers) {
        try {
          const parsed = typeof headers === 'string' ? JSON.parse(headers) : headers;
          requestHeaders = { ...requestHeaders, ...parsed };
        } catch (e) {
          logger.warn(`Failed to parse headers JSON: ${headers}`);
        }
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: requestHeaders,
        body: bodyContent,
      });
      
      if (!response.ok) {
        return `ERROR: Request failed with status ${response.status} ${response.statusText}`;
      }

      const responseText = await response.text();
      return responseText.length > 50000 
        ? responseText.slice(0, 50000) + '\n...[truncated]' 
        : responseText;

    } catch (error) {
      return `ERROR: ${(error as Error).message}`;
    }
  },
  {
    name: 'http_post',
    description: 'Perform an HTTP POST request to a specific URL with a body (JSON string) and return the response.',
    schema: z.object({
      url: z.string().url().describe('The valid URL to post to'),
      body: z.string().describe('The request body as a JSON string'),
      headers: z.string().optional().describe('Optional JSON string of request headers'),
    }),
  },
);