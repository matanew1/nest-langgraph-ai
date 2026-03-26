import { Injectable } from '@nestjs/common';

/**
 * Simple Prometheus-compatible metrics collector.
 * No external dependencies — generates text/plain exposition format.
 */
@Injectable()
export class MetricsService {
  private counters = new Map<string, Map<string, number>>();
  private histograms = new Map<string, number[]>();
  private gauges = new Map<string, number>();

  /** Increment a counter with optional labels. */
  inc(name: string, labels: Record<string, string> = {}, value = 1): void {
    const key = this.labelKey(labels);
    if (!this.counters.has(name)) this.counters.set(name, new Map());
    const bucket = this.counters.get(name)!;
    bucket.set(key, (bucket.get(key) ?? 0) + value);
  }

  /** Record a histogram observation (e.g., duration in seconds). */
  observe(name: string, value: number): void {
    if (!this.histograms.has(name)) this.histograms.set(name, []);
    const values = this.histograms.get(name)!;
    values.push(value);
    // Keep bounded to prevent memory leak (last 10K observations)
    if (values.length > 10_000) values.splice(0, values.length - 10_000);
  }

  /** Set a gauge value. */
  set(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  /** Generate Prometheus text exposition format. */
  serialize(): string {
    const lines: string[] = [];

    for (const [name, bucket] of this.counters) {
      lines.push(`# TYPE ${name} counter`);
      for (const [labels, value] of bucket) {
        lines.push(`${name}${labels} ${value}`);
      }
    }

    for (const [name, values] of this.histograms) {
      if (values.length === 0) continue;
      const sorted = [...values].sort((a, b) => a - b);
      const sum = values.reduce((a, b) => a + b, 0);
      const count = values.length;
      lines.push(`# TYPE ${name} summary`);
      lines.push(`${name}{quantile="0.5"} ${sorted[Math.floor(count * 0.5)]}`);
      lines.push(`${name}{quantile="0.9"} ${sorted[Math.floor(count * 0.9)]}`);
      lines.push(
        `${name}{quantile="0.99"} ${sorted[Math.min(Math.floor(count * 0.99), count - 1)]}`,
      );
      lines.push(`${name}_sum ${sum}`);
      lines.push(`${name}_count ${count}`);
    }

    for (const [name, value] of this.gauges) {
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name} ${value}`);
    }

    return lines.join('\n') + '\n';
  }

  private labelKey(labels: Record<string, string>): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return '';
    return '{' + entries.map(([k, v]) => `${k}="${v}"`).join(',') + '}';
  }
}
