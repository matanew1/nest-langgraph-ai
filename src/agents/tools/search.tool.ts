import { tavily } from '@tavily/core';
import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { env } from '../../config/env';

const logger = new Logger('SearchTool');

const client = tavily({ apiKey: env.tavilyKey });

export const searchTool = tool(
  async ({ query }) => {
    logger.log(`Executing with query: ${query}`);
    const response = await client.search(query, { maxResults: 5 });

    if (!response.results || response.results.length === 0) {
      return 'No search results found.';
    }

    return response.results
      .map(
        (r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.content}`,
      )
      .join('\n\n');
  },
  {
    name: 'search',
    description:
      'Search the web for current information, articles, documentation, and general knowledge',
    schema: z.object({
      query: z.string(),
    }),
  },
);
