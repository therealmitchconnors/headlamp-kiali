import {
  customDashboardJobs,
  CustomDashboardQuery,
  dashboardChartSelection,
  resolveCustomDashboard,
  validateCustomDashboard,
  validateResolvedCustomDashboard,
} from './customDashboards';

const chart = (index: number) => ({
  chart: { name: `Chart ${index}`, metricName: `m${index}`, dataType: 'raw' as const },
});
const dashboard = (count: number) =>
  validateResolvedCustomDashboard({
    name: 'd',
    title: 'D',
    items: Array.from({ length: count }, (_, index) => chart(index)),
  });
const query = (count = 9): CustomDashboardQuery => ({
  namespace: 'bookinfo',
  namespaceLabel: 'namespace',
  clusterLabel: 'cluster',
  metricCluster: 'east',
  singleClusterConfirmed: false,
  minutes: 15,
  end: 10000,
  dashboard: dashboard(count),
});
it('distinguishes eight source items from bounded expanded metadata without dropping charts', () => {
  expect(() =>
    validateCustomDashboard({ name: 'd', title: 'D', items: dashboard(9).items })
  ).toThrow('1 to 8');
  expect(dashboard(160).items).toHaveLength(160);
  expect(() => dashboard(161)).toThrow('1 to 160');
  const resolved = resolveCustomDashboard(
    [
      { name: 'root', title: 'Root', items: [{ include: 'leaf' }, chart(8)] },
      { name: 'leaf', title: 'Leaf', items: Array.from({ length: 8 }, (_, index) => chart(index)) },
    ],
    'root'
  );
  expect(resolved.dashboard.items).toHaveLength(9);
  expect(() => customDashboardJobs({ ...query(), dashboard: resolved.dashboard })).toThrow(
    '8 metric queries'
  );
});
it('queries only explicit names in definition order with original chart indices', () => {
  const input = { ...query(), chartNames: ['Chart 8', 'Chart 1'] };
  const jobs = customDashboardJobs(input);
  expect(jobs.map(job => [job.key, job.chartIndex, job.chart.name])).toEqual([
    ['1:0:value', 1, 'Chart 1'],
    ['8:0:value', 8, 'Chart 8'],
  ]);
  expect(jobs.map(job => job.expression)).toEqual([
    'sum(m1{namespace="bookinfo",cluster="east"})',
    'sum(m8{namespace="bookinfo",cluster="east"})',
  ]);
  expect(input.dashboard.items).toHaveLength(9);
});
it.each(
  [
    [],
    null,
    ['missing'],
    ['Chart 0', 'Chart 0'],
    [0],
    Array.from({ length: 9 }, (_, i) => `Chart ${i}`),
  ].map(chartNames => ({ chartNames }))
)('rejects invalid explicit selections %#', ({ chartNames }) => {
  expect(() => dashboardChartSelection(chartNames, dashboard(9))).toThrow('1 to 8');
});
it('enforces expanded metric/summary budgets after selecting charts', () => {
  const input = query();
  input.chartNames = input.dashboard.items.slice(0, 8).map(item => item.chart.name);
  expect(customDashboardJobs(input)).toHaveLength(8);
  input.dashboard.items[0].chart.dataType = 'histogram';
  expect(() => customDashboardJobs(input)).toThrow('8 metric queries');
  input.chartNames.pop();
  expect(customDashboardJobs(input)).toHaveLength(8);
  input.chartNames = ['Chart 0'];
  input.dashboard.items[0].chart.metrics = Array.from({ length: 4 }, (_, i) => ({
    metricName: `h${i}`,
    displayName: `H${i}`,
  }));
  expect(customDashboardJobs(input)).toHaveLength(8);
  input.chartNames.push('Chart 8');
  expect(() => customDashboardJobs(input)).toThrow('8 metric queries');
});
it('does not apply query-specific grouping or summary rules to unselected charts', () => {
  const input = query(2);
  input.dashboard.items[0].chart.aggregations = [{ label: 'le', displayName: 'Bucket' }];
  input.dashboard.items[1].chart.dataType = 'histogram';
  input.byLabels = ['le'];
  input.histogramSummaries = [];
  input.chartNames = ['Chart 0'];
  expect(customDashboardJobs(input)[0].expression).toContain(' by (le)');
  input.chartNames = ['Chart 1'];
  expect(() => customDashboardJobs(input)).toThrow('reserved le');
});
it('bounds resolved metadata text and preserves literal chart names', () => {
  expect(() =>
    validateResolvedCustomDashboard({
      name: 'd',
      title: 'D',
      items: Array.from({ length: 130 }, (_, i) => ({
        chart: {
          name: `${i}${'x'.repeat(240)}`,
          metricName: 'm'.repeat(256),
          unit: 'u'.repeat(128),
          dataType: 'raw',
        },
      })),
    })
  ).toThrow('64 KiB');
  const input = query(1);
  input.dashboard.items[0].chart.name = '__proto__';
  input.chartNames = ['__proto__'];
  expect(customDashboardJobs(input)[0].chart.name).toBe('__proto__');
});
