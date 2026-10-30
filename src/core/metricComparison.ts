import { metricGroupIdentity, metricGroupLabels } from './metricGroups';
import { MetricResult } from './telemetry';

export interface ComparisonMetric {
  name: string;
  result: MetricResult;
  colorIndex?: number;
  group?: string;
}
export function metricComparisonData(metrics: readonly ComparisonMetric[]) {
  const names = metrics.map(metric =>
    metric.group === undefined ? metric.name : `${JSON.stringify(metric.name)} ${metric.group}`
  );
  if (!metrics.length || metrics.length > 8 || new Set(names).size !== names.length)
    throw new Error('Metric comparison requires 1 to 8 distinctly named metrics');
  const series = metrics.map((metric, index) => ({
    name: names[index],
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
      (metric.group !== undefined && (!metric.group.trim() || metric.group.length > 1024)) ||
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

export function groupedMetricComparisons(
  metrics: readonly ComparisonMetric[],
  groupLabels: readonly string[],
  preserveSeriesOrder = false
): ComparisonMetric[] {
  const groups = metricGroupLabels(groupLabels);
  if (!groups.length) throw new Error('Choose explicit grouping labels for grouped comparisons');
  if (metrics.length > 8 || new Set(metrics.map(metric => metric.name)).size !== metrics.length)
    throw new Error('Grouped comparison requires at most 8 distinctly named metrics');
  const result = metrics.flatMap(metric => {
    if (metric.result.series.length > 8)
      throw new Error('Grouped comparison exceeds 8 series per metric');
    const series = metric.result.series.map(series => ({
      ...metricGroupIdentity(series.labels, groups),
      series,
    }));
    if (!preserveSeriesOrder) series.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    if (new Set(series.map(item => item.key)).size !== series.length)
      throw new Error('Grouped comparison contains duplicate label groups');
    return series.map(
      ({ caption, series }): ComparisonMetric => ({
        name: metric.name,
        group: caption,
        result: { warnings: [], series: [{ labels: {}, samples: series.samples }] },
      })
    );
  });
  if (result.length > 8)
    throw new Error(
      'Grouped chart exceeds 8 displayed series across its metrics; narrow the label filters'
    );
  return result;
}

export function metricCategoryData(metrics: readonly ComparisonMetric[]) {
  const { series } = metricComparisonData(metrics);
  const points = series.map((item, index) => {
    let latest: { timestamp: number; value: number | null } | undefined;
    for (const sample of metrics[index].result.series[0]?.samples ?? [])
      if (sample.value !== null) latest = sample;
    return {
      ...item,
      category: index + 1,
      timestamp: latest?.timestamp ?? null,
      value: latest?.value ?? null,
    };
  });
  return {
    points,
    mixedTimes:
      new Set(points.flatMap(point => (point.timestamp === null ? [] : [point.timestamp]))).size >
      1,
  };
}
