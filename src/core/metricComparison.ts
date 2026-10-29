import { MetricResult } from './telemetry';

export interface ComparisonMetric {
  name: string;
  result: MetricResult;
  colorIndex?: number;
}
export function metricComparisonData(metrics: readonly ComparisonMetric[]) {
  if (
    !metrics.length ||
    metrics.length > 8 ||
    new Set(metrics.map(metric => metric.name)).size !== metrics.length
  )
    throw new Error('Metric comparison requires 1 to 8 distinctly named metrics');
  const series = metrics.map((metric, index) => ({
    name: metric.name,
    key: `series${index}`,
    colorIndex: metric.colorIndex ?? index,
  }));
  if (
    series.some(
      series =>
        !Number.isInteger(series.colorIndex) || series.colorIndex < 0 || series.colorIndex >= 8
    ) ||
    new Set(series.map(series => series.colorIndex)).size !== series.length
  )
    throw new Error('Metric comparison requires distinct bounded series colors');
  const rows = new Map<number, { timestamp: number; [key: string]: number | null }>();
  metrics.forEach((metric, index) => {
    if (
      !metric.name.trim() ||
      metric.name.length > 256 ||
      metric.result.series.length > 1 ||
      metric.result.series.some(
        series => Object.keys(series.labels).length || series.samples.length > 241
      )
    )
      throw new Error('Metric comparison requires bounded scalar aggregate series');
    let previous = -Infinity;
    for (const sample of metric.result.series[0]?.samples ?? []) {
      if (
        !Number.isFinite(sample.timestamp) ||
        sample.timestamp <= previous ||
        (sample.value !== null && !Number.isFinite(sample.value))
      )
        throw new Error(
          'Metric comparison requires ordered finite timestamps and finite or unavailable values'
        );
      previous = sample.timestamp;
      let row = rows.get(sample.timestamp);
      if (!row) {
        row = { timestamp: sample.timestamp };
        for (const item of series) row[item.key] = null;
        rows.set(sample.timestamp, row);
      }
      row[series[index].key] = sample.value;
    }
  });
  return { series, rows: [...rows.values()].sort((a, b) => a.timestamp - b.timestamp) };
}
