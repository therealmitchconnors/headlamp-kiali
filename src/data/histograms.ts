import { ServiceEndpoint } from '../core/config';
import {
  decodeHistogram,
  histogramQueries,
  HistogramQuery,
  HistogramSummary,
} from '../core/histograms';
import { ClusterScope } from '../core/scope';
import { loadMetricRanges } from './metricRanges';
import { MetricRead } from './telemetry';

export interface HistogramSnapshot {
  query: HistogramQuery;
  summaries: { summary: HistogramSummary; read: MetricRead }[];
}
export async function loadHistograms(
  scope: ClusterScope,
  endpoint: ServiceEndpoint,
  query: HistogramQuery,
  signal: AbortSignal
): Promise<HistogramSnapshot> {
  signal.throwIfAborted();
  const captured = structuredClone(query);
  const queries = histogramQueries(captured);
  const snapshot = await loadMetricRanges(
    scope,
    endpoint,
    captured,
    queries.map(item => ({ key: item.summary, expression: item.expression })),
    signal,
    decodeHistogram,
    'Histogram reads exceeded 15 seconds'
  );
  return {
    query: snapshot.query,
    summaries: snapshot.metrics.map(item => ({ summary: item.key, read: item.read })),
  };
}
