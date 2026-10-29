import { metricGroupLabels } from './metricGroups';
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
export function histogramExpressions(
  name: string,
  labels: Readonly<Record<string, string>>,
  summaries: readonly HistogramSummary[],
  groupLabels: readonly string[] = []
): { summary: HistogramSummary; expression: string }[] {
  if (
    typeof name !== 'string' ||
    name.length > 256 ||
    /^[A-Za-z_:][A-Za-z0-9_:]*$/.exec(name)?.[0] !== name ||
    !Array.isArray(summaries) ||
    !summaries.length ||
    summaries.length > 5 ||
    new Set(summaries).size !== summaries.length ||
    summaries.some(value => !HISTOGRAM_SUMMARIES.some(summary => summary === value))
  )
    throw new Error(
      'Choose a bounded histogram metric name and 1 to 5 distinct supported summaries'
    );
  const selector = `{${metricSelector(labels)}}`;
  const groups = metricGroupLabels(groupLabels, true).join(',');
  const by = groups ? ` by (${groups})` : '';
  return summaries.map(summary => ({
    summary,
    expression:
      summary === 'avg'
        ? `sum(rate(${name}_sum${selector}[5m]))${by} / sum(rate(${name}_count${selector}[5m]))${by}`
        : `histogram_quantile(${
            quantiles[summary]
          }, sum(rate(${name}_bucket${selector}[5m])) by (le${groups ? `,${groups}` : ''}))`,
  }));
}
export function histogramQueries(
  query: HistogramQuery
): { summary: HistogramSummary; expression: string }[] {
  const labels = trafficMetricLabels(query);
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
  return histogramExpressions(name, labels, query.summaries);
}
export function decodeHistogram(response: unknown, query: HistogramQuery) {
  return decodeAggregatedRange(response, query, 'Histogram summary');
}
