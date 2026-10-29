import { isRecord } from './object';
import { decodePrometheus, trafficMetricLabels, TrafficQuery } from './telemetry';

export interface MetricTimeRange {
  minutes: 5 | 15 | 60;
  end: number;
}

export function validateMetricTimeRange(query: MetricTimeRange) {
  if (
    ![5, 15, 60].includes(query.minutes) ||
    !Number.isSafeInteger(query.end) ||
    query.end <= query.minutes * 60 ||
    query.end > 8640000000000
  )
    throw new Error('Choose a valid captured metric time range');
}
export function validateMetricRange(query: TrafficQuery) {
  trafficMetricLabels(query);
  validateMetricTimeRange(query);
}
export function metricRangeParameters(query: MetricTimeRange, expression: string): URLSearchParams {
  validateMetricTimeRange(query);
  if (typeof expression !== 'string' || !expression)
    throw new Error('A metric range query expression is required');
  const parameters = new URLSearchParams({
    query: expression,
    start: String(query.end - query.minutes * 60),
    end: String(query.end),
    step: '15',
  });
  if (parameters.toString().length > 16384)
    throw new Error('Encoded metric query parameters exceed 16 KiB');
  return parameters;
}

export function decodeAggregatedRange(
  response: unknown,
  query: TrafficQuery,
  label = 'Aggregated metric'
) {
  validateMetricRange(query);
  return decodeScalarRange(response, query, label, true);
}

export function decodeScalarRange(
  response: unknown,
  query: MetricTimeRange,
  label: string,
  nonnegative: boolean
) {
  validateMetricTimeRange(query);
  const maxSamples = Math.floor((query.minutes * 60) / 15) + 1;
  const aggregationError = `${label} returned unexpected aggregation labels or multiple series`;
  const rangeError = nonnegative
    ? `${label} samples exceed the captured range, sample budget or nonnegative domain`
    : `${label} samples exceed the captured range or sample budget`;
  if (
    isRecord(response) &&
    response.status === 'success' &&
    isRecord(response.data) &&
    Array.isArray(response.data.result)
  ) {
    if (response.data.result.length > 1) throw new Error(aggregationError);
    for (const entry of response.data.result) {
      if (isRecord(entry) && isRecord(entry.metric) && Object.keys(entry.metric).length)
        throw new Error(aggregationError);
      if (isRecord(entry) && Array.isArray(entry.values) && entry.values.length > maxSamples)
        throw new Error(rangeError);
    }
  }
  const metric = decodePrometheus(response, 'matrix');
  if (metric.series.length > 1 || metric.series.some(series => Object.keys(series.labels).length))
    throw new Error(aggregationError);
  const start = query.end - query.minutes * 60;
  if (
    metric.series.some(
      series =>
        series.samples.length > maxSamples ||
        series.samples.some(
          sample =>
            sample.timestamp < start - 1 ||
            sample.timestamp > query.end + 1 ||
            (nonnegative && sample.value !== null && sample.value < 0)
        )
    )
  )
    throw new Error(rangeError);
  return metric;
}
