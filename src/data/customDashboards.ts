import { ServiceEndpoint } from '../core/config';
import { customDashboardJobs, CustomDashboardQuery } from '../core/customDashboards';
import { decodeScalarRange } from '../core/metricRanges';
import { ClusterScope } from '../core/scope';
import { loadMetricRanges } from './metricRanges';

export async function loadCustomDashboard(
  scope: ClusterScope,
  endpoint: ServiceEndpoint,
  query: CustomDashboardQuery,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const captured = structuredClone(query);
  const jobs = customDashboardJobs(captured);
  const result = await loadMetricRanges(
    scope,
    endpoint,
    captured,
    jobs,
    signal,
    (response, range, key) => {
      const job = jobs.find(job => job.key === key);
      if (!job) throw new Error('Custom dashboard chart is missing from its captured request');
      const metric = decodeScalarRange(
        response,
        range,
        'Custom dashboard chart',
        job.chart.dataType === 'rate'
      );
      const scale = job.chart.unitScale ?? 1;
      return {
        ...metric,
        series: metric.series.map(series => ({
          ...series,
          samples: series.samples.map(sample => {
            if (sample.value === null) return sample;
            const value = sample.value * scale;
            if (!Number.isFinite(value) || (sample.value !== 0 && value === 0))
              throw new Error('Dashboard unit scaling overflowed or underflowed a finite sample');
            return { ...sample, value };
          }),
        })),
      };
    },
    'Custom dashboard reads exceeded 15 seconds'
  );
  return {
    ...result,
    charts: result.metrics.map(item => {
      const job = jobs.find(job => job.key === item.key);
      if (!job) throw new Error('Custom dashboard result has no captured chart');
      return {
        ...item,
        chart: job.chart,
        chartIndex: job.chartIndex,
        metric: job.metric,
        ...(job.summary ? { summary: job.summary } : {}),
      };
    }),
  };
}
