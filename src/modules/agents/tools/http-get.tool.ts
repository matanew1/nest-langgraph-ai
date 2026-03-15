import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';

const logger = new Logger('HttpGetTool');

export const httpGetTool = tool(
  async ({ url }) => {
    logger.log(`GET request to: ${url}`);

    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        return `ERROR: Request failed with status ${response.status} ${response.statusText}`;
      }

      const contentType = response.headers.get('content-type') || '';
      
      // If it's JSON, return formatted JSON. Otherwise return text.
      if (contentType.includes('application/json')) {
        const data = await response.json();
        return JSON.stringify(data, null, 2);
      }
      
      const text = await response.text();
      // Truncate if too long (simple guard)
      return text.length > 50000 
        ? text.slice(0, 50000) + '\n...[truncated]' 
        : text;

    } catch (error) {
      return `ERROR: ${(error as Error).message}`;
    }
  },
  {
    name: 'http_get',
    description: 'Perform an HTTP GET request to a specific URL and return the response body (JSON or text).',
    schema: z.object({
      url: z.string().url().describe('The valid URL to fetch'),
    }),
  },
);