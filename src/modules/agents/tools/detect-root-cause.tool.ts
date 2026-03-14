import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { invokeLlm } from '@llm/llm.provider';
import { env } from '@config/env';
import { splunkSearch, formatEvents } from './splunk.client';

const logger = new Logger('DetectRootCauseTool');

/** Build a Splunk SPL that targets errors / exceptions / fatal messages. */
function buildErrorSpl(index: string, service?: string, pattern?: string): string {
  const serviceFilter = service ? ` AND (host="${service}" OR source="*${service}*")` : '';
  const patternFilter = pattern ? ` AND "${pattern}"` : '';
  return (
    `index="${index}"${serviceFilter}${patternFilter} ` +
    `(level=ERROR OR level=FATAL OR level=CRITICAL OR ` +
    `"Exception" OR "Error" OR "FAILED" OR "panic" OR "fatal") ` +
    `| eval timestamp=strftime(_time,"%Y-%m-%dT%H:%M:%S") ` +
    `| table timestamp, host, source, sourcetype, _raw ` +
    `| sort -_time ` +
    `| head 300`
  );
}

export const detectRootCauseTool = tool(
  async ({ index, service, earliest_time, latest_time, pattern, spl }) => {
    const indexName = index ?? env.splunkDefaultIndex;
    const query = spl ?? buildErrorSpl(indexName, service, pattern);

    logger.log(
      `detect_root_cause: service="${service ?? '*'}" pattern="${pattern ?? '*'}" [${earliest_time} → ${latest_time}]`,
    );

    let events: Awaited<ReturnType<typeof splunkSearch>>;
    try {
      events = await splunkSearch(query, earliest_time, latest_time, 300);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `ERROR: Splunk query failed — ${msg}`;
    }

    if (!events.length) {
      return `No error/exception events found for the given filters (${earliest_time} → ${latest_time}). The service may be healthy.`;
    }

    const rawLogs = formatEvents(events, 200);

    const prompt = `You are a senior site-reliability engineer performing root cause analysis (RCA).

Analyse the error logs below and produce a structured RCA report with these sections:

1. **Incident Summary** — what went wrong, when it started, approximate impact
2. **Root Cause** — the primary technical cause (be specific: exact error message, class, module, query, etc.)
3. **Contributing Factors** — secondary factors (config drift, dependency failure, traffic spike, etc.)
4. **Evidence** — the 3-5 most important log lines that support the root cause conclusion
5. **Confidence** — your confidence level (High / Medium / Low) and why

Context:
- Service: ${service ?? 'unknown'}
- Time window: ${earliest_time} → ${latest_time}
- Total error events: ${events.length}

Error log events (up to 200 shown):
${rawLogs}`;

    logger.log(`Running RCA LLM analysis on ${events.length} error events`);
    return invokeLlm(prompt);
  },
  {
    name: 'detect_root_cause',
    description:
      'Query Splunk for errors/exceptions in a time window and use AI to perform root cause analysis (RCA). ' +
      'Returns a structured RCA report: incident summary, root cause, contributing factors, evidence, and confidence level.',
    schema: z.object({
      index: z
        .string()
        .optional()
        .describe('Splunk index to search (default: SPLUNK_DEFAULT_INDEX env var)'),
      service: z
        .string()
        .optional()
        .describe('Service or host name filter, e.g. "api-gateway", "payment-service"'),
      earliest_time: z
        .string()
        .default('-1h')
        .describe('Start of the investigation window, e.g. "-2h", "-30m", "-1d@d"'),
      latest_time: z
        .string()
        .default('now')
        .describe('End of the investigation window (default: "now")'),
      pattern: z
        .string()
        .optional()
        .describe(
          'Optional keyword or error pattern to narrow results, e.g. "OutOfMemoryError", "connection refused"',
        ),
      spl: z
        .string()
        .optional()
        .describe(
          'Override: provide a full custom SPL query instead of using the auto-generated one',
        ),
    }),
  },
);
