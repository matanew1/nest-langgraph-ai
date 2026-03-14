import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { invokeLlm } from '@llm/llm.provider';
import { env } from '@config/env';
import { splunkSearch, formatEvents } from './splunk.client';

const logger = new Logger('AnalyzeLogsTool');

export const analyzeLogsTool = tool(
  async ({ spl, index, earliest_time, latest_time, focus }) => {
    const indexClause = index ?? env.splunkDefaultIndex;

    // Build SPL: user can pass a full SPL or just a keyword/filter
    const query = spl
      ? spl
      : `index="${indexClause}" | head 200 | table _time, host, source, sourcetype, _raw`;

    logger.log(`analyze_logs: query="${query.slice(0, 120)}" [${earliest_time} → ${latest_time}]`);

    let events: Awaited<ReturnType<typeof splunkSearch>>;
    try {
      events = await splunkSearch(query, earliest_time, latest_time, 200);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `ERROR: Splunk query failed — ${msg}`;
    }

    if (!events.length) {
      return `No log events found for the given query and time window (${earliest_time} → ${latest_time}).`;
    }

    const rawLogs = formatEvents(events, 150);

    const instruction = focus
      ? `You are a log analysis expert. The user wants to know: "${focus}". Analyse the Splunk logs below and provide a concise, structured answer. Highlight anomalies, patterns, error spikes, or anything noteworthy.`
      : `You are a log analysis expert. Analyse the Splunk logs below. Provide: (1) a summary of overall health, (2) any warnings or errors, (3) traffic/activity patterns, (4) key observations. Be concise and structured.`;

    const prompt = `${instruction}\n\nLog events (${events.length} total, up to 150 shown):\n\n${rawLogs}`;

    logger.log(`Sending ${events.length} events to LLM for analysis`);
    return invokeLlm(prompt);
  },
  {
    name: 'analyze_logs',
    description:
      'Query Splunk for log events using an SPL search and get an AI-powered analysis. ' +
      'Use for summarizing log activity, spotting error trends, or answering questions about system behaviour over a time window.',
    schema: z.object({
      spl: z
        .string()
        .optional()
        .describe(
          'Full Splunk SPL query, e.g. "index=\\"prod\\" level=ERROR | stats count by host". ' +
            'If omitted, fetches the 200 most recent events from the specified index.',
        ),
      index: z
        .string()
        .optional()
        .describe('Splunk index to search (default: SPLUNK_DEFAULT_INDEX env var)'),
      earliest_time: z
        .string()
        .default('-1h')
        .describe('Splunk time modifier for start of window, e.g. "-1h", "-24h@h", "-7d"'),
      latest_time: z
        .string()
        .default('now')
        .describe('Splunk time modifier for end of window (default: "now")'),
      focus: z
        .string()
        .optional()
        .describe(
          'Optional specific question to answer, e.g. "How many 5xx errors occurred per hour?"',
        ),
    }),
  },
);
