import { validateMetricChartType } from './chartDisplay';
import {
  customDashboardJobs,
  CustomDashboardQuery,
  resolveCustomDashboard,
  validateCustomDashboard,
} from './customDashboards';

const query = (): CustomDashboardQuery => ({
  namespace: 'bookinfo',
  namespaceLabel: 'namespace',
  clusterLabel: 'cluster',
  metricCluster: 'east',
  singleClusterConfirmed: false,
  minutes: 15,
  end: 10000,
  dashboard: {
    name: 'runtime',
    title: 'Runtime',
    items: [{ chart: { name: 'C', metricName: 'm', dataType: 'raw', groupLabels: ['pod'] } }],
  },
});
it.each(
  (['line', 'area', 'bar', 'scatter'] as const).flatMap(chartType =>
    (['raw', 'rate', 'histogram'] as const).map(dataType => ({ chartType, dataType }))
  )
)(
  'captures $chartType for $dataType without changing scoped query plans',
  ({ chartType, dataType }) => {
    const input = query();
    input.dashboard.items[0].chart.dataType = dataType;
    const expressions = customDashboardJobs(input).map(job => job.expression);
    input.dashboard.items[0].chart.chartType = chartType;
    const jobs = customDashboardJobs(input);
    expect(jobs.map(job => job.expression)).toEqual(expressions);
    expect(jobs.every(job => job.chart.chartType === chartType)).toBe(true);
    expect(
      resolveCustomDashboard(
        [input.dashboard, { name: 'parent', title: 'Parent', items: [{ include: 'runtime' }] }],
        'parent'
      ).dashboard.items[0].chart.chartType
    ).toBe(chartType);
  }
);
it.each([undefined, null, ''])(
  'keeps unspecified style absent instead of changing saved definitions: %j',
  chartType => {
    expect(validateMetricChartType(chartType)).toBeUndefined();
    const input = query();
    expect(
      validateCustomDashboard({
        ...input.dashboard,
        items: [{ chart: { ...input.dashboard.items[0].chart, chartType } }],
      }).items[0].chart.chartType
    ).toBeUndefined();
  }
);
it.each(['pie', 'Line', 'stacked-area', 'line\n', true, 0, {}, []].map(input => ({ input })))(
  'rejects unsupported chart style $input instead of silently choosing line',
  ({ input }) => {
    expect(() => validateMetricChartType(input)).toThrow('Chart type');
  }
);
