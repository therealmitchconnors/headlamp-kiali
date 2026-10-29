import { decodeAggregatedRange } from './metricRanges';
import { metricSelector, trafficMetricLabels, TrafficQuery } from './telemetry';

export const TRAFFIC_HISTOGRAMS = {
  duration: { metric: 'istio_request_duration_milliseconds', unit: 'ms' },
  requestSize: { metric: 'istio_request_bytes', unit: 'bytes' },
  responseSize: { metric: 'istio_response_bytes', unit: 'bytes' },
} as const;
export const HISTOGRAM_SUMMARIES = ['avg', 'p50', 'p90', 'p95', 'p99'] as const;
export type HistogramSummary = (typeof HISTOGRAM_SUMMARIES)[number];
export interface HistogramQuery extends TrafficQuery {
  metric: keyof typeof TRAFFIC_HISTOGRAMS;
  summaries: HistogramSummary[];
}
const quantiles = { p50: '0.5', p90: '0.9', p95: '0.95', p99: '0.99' };
export function histogramQueries(
  query: HistogramQuery
): { summary: HistogramSummary; expression: string }[] {
  const labels = `{${metricSelector(trafficMetricLabels(query))}}`;
  if (
    !Object.prototype.hasOwnProperty.call(TRAFFIC_HISTOGRAMS, query.metric) ||
    !Array.isArray(query.summaries) ||
    !query.summaries.length ||
    query.summaries.length > 5 ||
    new Set(query.summaries).size !== query.summaries.length ||
    query.summaries.some(value => !HISTOGRAM_SUMMARIES.some(summary => summary === value)) ||
    !Number.isSafeInteger(query.end) ||
    query.end <= query.minutes * 60 ||
    query.end > 8640000000000
  )
    throw new Error(
      'Choose an available histogram, 1 to 5 distinct summaries and a valid captured time'
    );
  const name = TRAFFIC_HISTOGRAMS[query.metric].metric;
  return query.summaries.map(summary => ({
    summary,
    expression:
      summary === 'avg'
        ? `sum(rate(${name}_sum${labels}[5m])) / sum(rate(${name}_count${labels}[5m]))`
        : `histogram_quantile(${quantiles[summary]}, sum(rate(${name}_bucket${labels}[5m])) by (le))`,
  }));
}
export function decodeHistogram(response: unknown, query: HistogramQuery) {
  return decodeAggregatedRange(response, query, 'Histogram summary');
}
