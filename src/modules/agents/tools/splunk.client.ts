import { Logger } from '@nestjs/common';
import { env } from '@config/env';

const logger = new Logger('SplunkClient');

/** Raw Splunk event row (field → value map). */
export type SplunkEvent = Record<string, string>;

interface SplunkJobCreateResponse {
  sid: string;
}

interface SplunkJobStatusEntry {
  content: { isDone: boolean; resultCount: number; messages?: { type: string; text: string }[] };
}

interface SplunkResultsResponse {
  results: SplunkEvent[];
}

/** Build common auth + content-type headers for every Splunk REST call. */
function headers(contentType: 'form' | 'json' = 'json'): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/json',
  };
  if (env.splunkToken) {
    h['Authorization'] = `Bearer ${env.splunkToken}`;
  }
  if (contentType === 'form') {
    h['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  return h;
}

/**
 * Execute a Splunk SPL query and return the raw result rows.
 *
 * @param spl          Full SPL query string (with or without leading "search ")
 * @param earliestTime Splunk time modifier, e.g. "-1h", "-24h@h", "2024-01-01T00:00:00"
 * @param latestTime   Splunk time modifier, default "now"
 * @param maxResults   Maximum rows to return (Splunk default cap is 50 000)
 */
export async function splunkSearch(
  spl: string,
  earliestTime = '-1h',
  latestTime = 'now',
  maxResults = 200,
): Promise<SplunkEvent[]> {
  const baseUrl = env.splunkUrl.replace(/\/$/, '');
  const query = spl.trimStart().startsWith('search ') ? spl : `search ${spl}`;

  // ── 1. Create async search job ──────────────────────────────────────────
  const jobBody = new URLSearchParams({
    search: query,
    earliest_time: earliestTime,
    latest_time: latestTime,
    output_mode: 'json',
  });

  logger.log(`Creating Splunk job: "${query.slice(0, 120)}" [${earliestTime} → ${latestTime}]`);

  const jobRes = await fetch(`${baseUrl}/services/search/jobs`, {
    method: 'POST',
    headers: headers('form'),
    body: jobBody.toString(),
  });

  if (!jobRes.ok) {
    const body = await jobRes.text();
    throw new Error(`Splunk job creation failed (${jobRes.status}): ${body.slice(0, 300)}`);
  }

  const { sid } = (await jobRes.json()) as SplunkJobCreateResponse;
  logger.log(`Splunk job created: sid=${sid}`);

  // ── 2. Poll until done ──────────────────────────────────────────────────
  const { splunkPollIntervalMs, splunkPollMaxAttempts } = env;

  for (let attempt = 0; attempt < splunkPollMaxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, splunkPollIntervalMs));

    const statusRes = await fetch(`${baseUrl}/services/search/jobs/${sid}?output_mode=json`, {
      headers: headers(),
    });

    if (!statusRes.ok) continue;

    const statusData = (await statusRes.json()) as { entry: SplunkJobStatusEntry[] };
    const content = statusData?.entry?.[0]?.content;

    if (content?.isDone) {
      logger.log(`Splunk job ${sid} done — ${content.resultCount} results`);
      break;
    }
  }

  // ── 3. Fetch results ────────────────────────────────────────────────────
  const resultsRes = await fetch(
    `${baseUrl}/services/search/jobs/${sid}/results?output_mode=json&count=${maxResults}`,
    { headers: headers() },
  );

  if (!resultsRes.ok) {
    throw new Error(`Splunk results fetch failed (${resultsRes.status})`);
  }

  const { results } = (await resultsRes.json()) as SplunkResultsResponse;
  return results ?? [];
}

/**
 * Format Splunk events into a compact, LLM-readable text block.
 * Each event becomes a single line with key=value pairs (sorted, _-prefixed
 * Splunk internal fields are omitted unless they carry useful content).
 */
export function formatEvents(events: SplunkEvent[], maxEvents = 100): string {
  if (!events.length) return '(no events returned)';

  const SKIP_PREFIXES = ['punct', 'linecount'];
  const visible = events.slice(0, maxEvents);

  return visible
    .map((ev, i) => {
      const fields = Object.entries(ev)
        .filter(([k]) => !SKIP_PREFIXES.some((p) => k.startsWith(p)))
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join('  ');
      return `[${i + 1}] ${fields}`;
    })
    .join('\n');
}
