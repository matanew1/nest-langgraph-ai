import { tool } from '@langchain/core/tools';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { invokeLlm } from '@llm/llm.provider';
import { env } from '@config/env';
import { splunkSearch, formatEvents } from './splunk.client';

const logger = new Logger('SuggestFixTool');

export const suggestFixTool = tool(
  async ({ root_cause, service, stack, tech_stack, validate_with_splunk, index, earliest_time }) => {
    logger.log(`suggest_fix: service="${service ?? 'unknown'}" tech="${tech_stack ?? 'auto-detect'}"`);

    // ── Optional: pull recent similar errors from Splunk to validate the fix ──
    let splunkContext = '';
    if (validate_with_splunk && root_cause) {
      const indexName = index ?? env.splunkDefaultIndex;
      // Extract a short keyword from root_cause for the search
      const keyword = root_cause.split(/\s+/).find((w) => w.length > 5) ?? root_cause.slice(0, 30);
      const spl =
        `index="${indexName}" "${keyword}" ` +
        `(level=ERROR OR level=FATAL OR "Exception") ` +
        `| table _time, host, source, _raw | sort -_time | head 50`;

      try {
        const events = await splunkSearch(spl, earliest_time ?? '-24h', 'now', 50);
        if (events.length) {
          splunkContext = `\n\nRecent Splunk evidence (${events.length} events matching the root cause):\n${formatEvents(events, 30)}`;
        }
      } catch {
        logger.warn('Splunk validation fetch failed — continuing without it');
      }
    }

    const prompt = `You are a senior software engineer and incident responder specialised in ${tech_stack ?? 'modern cloud-native applications'}.

A root cause has been identified. Provide a clear, actionable fix plan.

ROOT CAUSE:
${root_cause}

${service ? `AFFECTED SERVICE: ${service}` : ''}
${stack ? `STACK TRACE / ADDITIONAL CONTEXT:\n${stack}` : ''}
${splunkContext}

Produce the following sections:

1. **Immediate Mitigation** (stop the bleeding now — restarts, feature flags, rollbacks, circuit breakers)
2. **Root Fix** — the exact code/config/infrastructure change needed to permanently resolve this issue
   - Include concrete code snippets, config diffs, or commands where applicable
3. **Verification Steps** — how to confirm the fix worked (metrics to check, Splunk queries to run, tests to pass)
4. **Prevention** — what to add so this never happens again (alerts, retries, validations, tests)
5. **Risk** — any risk introduced by the fix and how to mitigate it

Be specific and practical. Prefer code over prose.`;

    return invokeLlm(prompt);
  },
  {
    name: 'suggest_fix',
    description:
      'Given a root cause description, generate a detailed fix plan: immediate mitigation, root fix with code snippets, ' +
      'verification steps, and prevention measures. Optionally validates the fix against recent Splunk error data.',
    schema: z.object({
      root_cause: z
        .string()
        .describe(
          'The identified root cause, e.g. "NullPointerException in PaymentService.charge() when card token is expired"',
        ),
      service: z
        .string()
        .optional()
        .describe('Name of the affected service, e.g. "payment-service"'),
      stack: z
        .string()
        .optional()
        .describe('Stack trace or additional error context to include in the fix analysis'),
      tech_stack: z
        .string()
        .optional()
        .describe(
          'Technology stack for the fix, e.g. "TypeScript/NestJS", "Java/Spring Boot", "Python/FastAPI"',
        ),
      validate_with_splunk: z
        .boolean()
        .default(false)
        .describe(
          'If true, fetches recent Splunk events matching the root cause keyword to cross-validate the fix',
        ),
      index: z
        .string()
        .optional()
        .describe('Splunk index for validation (default: SPLUNK_DEFAULT_INDEX env var)'),
      earliest_time: z
        .string()
        .optional()
        .describe('Time window for Splunk validation, default "-24h"'),
    }),
  },
);
