import { validateMetricChartAxis } from './chartDisplay';
import {
  customDashboardJobs,
  CustomDashboardQuery,
  validateCustomDashboard,
} from './customDashboards';
import { ComparisonMetric, metricCategoryData } from './metricComparison';

const metric = (
  name: string,
  samples: { timestamp: number; value: number | null }[]
): ComparisonMetric => ({
  name,
  result: { warnings: [], series: [{ labels: {}, samples }] },
});
it('selects the newest finite sample, retaining zero, source order and exact sample time', () => {
  const metrics = [
    metric('Zero', [
      { timestamp: 0, value: -2 },
      { timestamp: 10, value: 0 },
      { timestamp: 20, value: null },
    ]),
    metric('Negative', [
      { timestamp: 5, value: -3 },
      { timestamp: 20, value: null },
    ]),
    metric('Missing', [{ timestamp: 20, value: null }]),
  ];
  const original = structuredClone(metrics);
  const data = metricCategoryData(metrics);
  expect(
    data.points.map(({ name, category, value, timestamp }) => ({
      name,
      category,
      value,
      timestamp,
    }))
  ).toEqual([
    { name: 'Zero', category: 1, value: 0, timestamp: 10 },
    { name: 'Negative', category: 2, value: -3, timestamp: 5 },
    { name: 'Missing', category: 3, value: null, timestamp: null },
  ]);
  expect(data.mixedTimes).toBe(true);
  expect(metrics).toEqual(original);
});
it('retains the Unix epoch and distinguishes all-unavailable, empty and equal-time series', () => {
  expect(
    metricCategoryData([metric('Epoch', [{ timestamp: 0, value: 0 }])]).points[0]
  ).toMatchObject({ timestamp: 0, value: 0 });
  const missing = metricCategoryData([
    metric('Empty', []),
    { name: 'Absent', result: { warnings: [], series: [] } },
  ]);
  expect(missing.points.map(point => point.value)).toEqual([null, null]);
  expect(missing.mixedTimes).toBe(false);
  expect(
    metricCategoryData([
      metric('A', [{ timestamp: 4, value: 0 }]),
      metric('B', [{ timestamp: 4, value: 2 }]),
    ]).mixedTimes
  ).toBe(false);
});
it('retains validated names/colors and rejects malformed scalar evidence rather than choosing a fallback', () => {
  const source = {
    ...metric('Metric', [{ timestamp: 2, value: 1 }]),
    group: '{pod="z"}',
    colorIndex: 4,
  };
  expect(metricCategoryData([source]).points[0]).toMatchObject({
    name: '"Metric" {pod="z"}',
    colorIndex: 4,
  });
  for (const metrics of [
    [metric('A', [{ timestamp: 2, value: Infinity }])],
    [
      metric('A', [
        { timestamp: 2, value: 1 },
        { timestamp: 1, value: 2 },
      ]),
    ],
    [metric('A', []), metric('A', [])],
    Array.from({ length: 9 }, (_, i) => metric(String(i), [])),
  ])
    expect(() => metricCategoryData(metrics)).toThrow();
});
it.each([undefined, null, '', 'time', 'series'])(
  'normalizes the bounded axis declaration %j',
  xAxis => {
    expect(validateMetricChartAxis(xAxis)).toBe(
      xAxis === 'time' || xAxis === 'series' ? xAxis : undefined
    );
  }
);
it.each(['categories', 'time\n', 1, true, {}, []].map(xAxis => ({ xAxis })))(
  'rejects invalid xAxis $xAxis',
  ({ xAxis }) => {
    expect(() => validateMetricChartAxis(xAxis)).toThrow('xAxis');
  }
);
it.each(['raw', 'rate', 'histogram'] as const)(
  'captures series axis without changing %s queries or data type',
  dataType => {
    const query: CustomDashboardQuery = {
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
        items: [{ chart: { name: 'M', metricName: 'm', dataType } }],
      },
    };
    const expressions = customDashboardJobs(query).map(job => job.expression);
    query.dashboard.items[0].chart.xAxis = 'series';
    expect(customDashboardJobs(query).map(job => job.expression)).toEqual(expressions);
    expect(customDashboardJobs(query).every(job => job.chart.xAxis === 'series')).toBe(true);
    const raw = {
      ...query.dashboard,
      items: [{ chart: { ...query.dashboard.items[0].chart, chartType: '' } }],
    };
    expect(validateCustomDashboard(raw).items[0].chart).toMatchObject({
      xAxis: 'series',
      chartType: 'line',
    });
  }
);
