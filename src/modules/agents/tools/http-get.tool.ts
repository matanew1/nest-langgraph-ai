import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { performHttpRequest } from './http-request.util';

const logger = new Logger('HttpGetTool');

export const httpGetTool = tool(
  async ({ url }) => {
    logger.log(`GET request to: ${url}`);
    return performHttpRequest({ url, method: 'GET' });
  },
  {
    name: 'http_get',
    description:
      'Perform an HTTP GET request to a specific URL and return the response body (JSON or text). Requests are restricted by the outbound HTTP tool policy.',
    schema: z.object({
      url: z.string().url().describe('The valid URL to fetch'),
    }),
  },
);
