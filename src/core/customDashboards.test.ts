import oracleText from '../../test-files/parity/custom-dashboard-query-oracle.json?raw';
import {
  customChartMetrics,
  customDashboardJobs,
  CustomDashboardQuery,
  validateCustomDashboard,
  validateCustomDashboardSettings,
} from './customDashboards';
import { HistogramSummary } from './histograms';
import { metricRangeParameters } from './metricRanges';
const oracle: {
  cases: {
    input: {
      namespace: string;
      namespaceLabel: string;
      clusterLabel: string | null;
      metricCluster: string;
      chart: CustomDashboardQuery['dashboard']['items'][number]['chart'];
      histogramSummaries?: HistogramSummary[];
    };
    expected: string | Record<string, string>;
  }[];
} = JSON.parse(oracleText);
it.each(oracle.cases)(
  'matches original custom raw/rate/histogram grouped query construction %#',
  ({ input, expected }) => {
    const jobs = customDashboardJobs({
      ...input,
      minutes: 15,
      end: 10000,
      singleClusterConfirmed: true,
      dashboard: { name: 'runtime', title: 'Runtime', items: [{ chart: input.chart }] },
    });
    expect(
      typeof expected === 'string'
        ? jobs[0].expression
        : Object.fromEntries(jobs.map(job => [job.summary, job.expression]))
    ).toEqual(expected);
  }
);

const chart = {
  name: 'Memory',
  metricName: 'container_memory_working_set_bytes',
  unit: 'bytes',
  dataType: 'raw',
};
const dashboard = { name: 'runtime', title: 'Runtime', items: [{ chart }] };
const settings = { namespaceLabel: 'namespace', clusterLabel: 'cluster', dashboards: [dashboard] };
const query = (): CustomDashboardQuery => ({
  namespace: 'bookinfo',
  metricCluster: 'east',
  singleClusterConfirmed: false,
  namespaceLabel: 'namespace',
  clusterLabel: 'cluster',
  dashboard: validateCustomDashboard(dashboard),
  minutes: 15,
  end: 10000,
});
it.each([undefined, null, ''])(
  'keeps unspecified unit %# distinct from a declared physical unit',
  unit => {
    const result = validateCustomDashboard({
      ...dashboard,
      items: [{ chart: { ...chart, unit, unitScale: 0.001 } }],
    });
    expect(result.items[0].chart.unit).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result.items[0].chart, 'unit')).toBe(false);
    expect(result.items[0].chart.unitScale).toBe(0.001);
    expect(customDashboardJobs({ ...query(), dashboard: result })[0].expression).toBe(
      'sum(container_memory_working_set_bytes{namespace="bookinfo",cluster="east"})'
    );
  }
);
it.each([42, {}, '   ', 'bytes\n', 'b'.repeat(129)])(
  'rejects invalid declared unit %# instead of silently treating it as unspecified',
  unit => {
    expect(() =>
      validateCustomDashboard({ ...dashboard, items: [{ chart: { ...chart, unit } }] })
    ).toThrow('Chart unit');
  }
);
it('normalizes the bounded Kiali raw/rate subset and preserves explicit scope and escaping', () => {
  expect(customDashboardJobs(query())[0].expression).toBe(
    'sum(container_memory_working_set_bytes{namespace="bookinfo",cluster="east"})'
  );
  const rate = query();
  rate.dashboard.items[0].chart = {
    ...rate.dashboard.items[0].chart,
    dataType: 'rate',
    metricName: 'my:counter_total',
  };
  rate.metricCluster = 'east"\\west';
  expect(customDashboardJobs(rate)[0].expression).toBe(
    'sum(rate(my:counter_total{namespace="bookinfo",cluster="east\\"\\\\west"}[5m]))'
  );
  for (const aggregator of ['sum', 'avg', 'min', 'max'] as const) {
    const raw = query();
    raw.dashboard.items[0].chart.aggregator = aggregator;
    expect(customDashboardJobs(raw)[0].expression.startsWith(`${aggregator}(`)).toBe(true);
  }
});
it('requires explicit single-cluster acknowledgment when omitting the metric cluster filter', () => {
  const input = { ...query(), clusterLabel: null, metricCluster: '' };
  expect(() => customDashboardJobs(input)).toThrow('Confirm');
  input.singleClusterConfirmed = true;
  expect(customDashboardJobs(input)[0].expression).toBe(
    'sum(container_memory_working_set_bytes{namespace="bookinfo"})'
  );
  expect(() => customDashboardJobs({ ...query(), metricCluster: '' })).toThrow(
    'Metric cluster value'
  );
  expect(() => customDashboardJobs({ ...query(), clusterLabel: 'namespace' })).toThrow(
    'must differ'
  );
});
it.each([
  { ...dashboard, includes: ['other'] },
  { ...dashboard, items: [{ include: 'other' }] },
  { ...dashboard, items: [{ chart: { ...chart, dataType: 'unsupported' } }] },
  { ...dashboard, items: [{ chart: { ...chart, groupLabels: ['bad-label'] } }] },
  { ...dashboard, items: [{ chart: { ...chart, metricName: 'up} or vector(1)' } }] },
  { ...dashboard, items: [{ chart: { ...chart, unitScale: -1 } }] },
  { ...dashboard, items: [{ chart: { ...chart, unitScale: Infinity } }] },
  { ...dashboard, items: [{ chart: { ...chart, dataType: 'rate', aggregator: 'avg' } }] },
  { ...dashboard, items: [] },
  { ...dashboard, items: [{ chart }, { chart }] },
])('rejects unsupported or invalid chart/template settings %#', input => {
  expect(() => validateCustomDashboard(input)).toThrow();
});
it('bounds definitions, charts and normalized text without dropping unsupported fields', () => {
  const eight = {
    ...dashboard,
    items: Array.from({ length: 8 }, (_, i) => ({ chart: { ...chart, name: `chart-${i}` } })),
  };
  expect(validateCustomDashboard(eight).items).toHaveLength(8);
  expect(() =>
    validateCustomDashboard({
      ...eight,
      items: [...eight.items, { chart: { ...chart, name: 'extra' } }],
    })
  ).toThrow('1 to 8');
  expect(
    validateCustomDashboardSettings({
      ...settings,
      dashboards: Array.from({ length: 20 }, (_, i) => ({ ...dashboard, name: `d${i}` })),
    }).dashboards
  ).toHaveLength(20);
  expect(() =>
    validateCustomDashboardSettings({ ...settings, dashboards: Array(21).fill(dashboard) })
  ).toThrow('At most 20');
  expect(() =>
    validateCustomDashboardSettings({ ...settings, dashboards: [dashboard, dashboard] })
  ).toThrow('distinct');
  expect(() =>
    validateCustomDashboardSettings({ ...settings, namespaceLabel: '__name__' })
  ).toThrow('other than __name__');
  expect(() => validateCustomDashboardSettings({ ...settings, clusterLabel: 'bad\n' })).toThrow();
  expect(() =>
    validateCustomDashboardSettings({
      ...settings,
      dashboards: Array.from({ length: 20 }, (_, i) => ({
        ...eight,
        name: `d${i}`,
        items: eight.items.map((item, index) => ({
          chart: {
            ...item.chart,
            name: `${index}${'x'.repeat(250)}`,
            metricName: 'm'.repeat(256),
            unit: 'u'.repeat(128),
          },
        })),
      })),
    })
  ).toThrow('64 KiB');
});
it('preserves zero scale as the pinned default of one and rejects bad range inputs', () => {
  expect(
    validateCustomDashboard({ ...dashboard, items: [{ chart: { ...chart, unitScale: 0 } }] })
      .items[0].chart.unitScale
  ).toBe(1);
  for (const end of [NaN, Infinity, 0, 900])
    expect(() => customDashboardJobs({ ...query(), end })).toThrow('time range');
  expect(() => customDashboardJobs({ ...query(), namespace: '../bookinfo' })).toThrow('namespace');
});

it('expands classic histograms into exact average and selected quantile jobs', () => {
  const input = query();
  input.dashboard.items[0].chart = {
    name: 'Temperature',
    metricName: 'temperature_celsius',
    unit: 'C',
    dataType: 'histogram',
  };
  expect(customDashboardJobs(input).map(job => [job.key, job.summary])).toEqual([
    ['0:0:avg', 'avg'],
    ['0:0:p95', 'p95'],
  ]);
  input.histogramSummaries = ['avg', 'p50', 'p90', 'p95', 'p99'];
  const jobs = customDashboardJobs(input);
  expect(jobs[0].expression).toBe(
    'sum(rate(temperature_celsius_sum{namespace="bookinfo",cluster="east"}[5m])) / sum(rate(temperature_celsius_count{namespace="bookinfo",cluster="east"}[5m]))'
  );
  for (const [index, quantile] of ['0.5', '0.9', '0.95', '0.99'].entries())
    expect(jobs[index + 1].expression).toBe(
      `histogram_quantile(${quantile}, sum(rate(temperature_celsius_bucket{namespace="bookinfo",cluster="east"}[5m])) by (le))`
    );
});
it('bounds expanded queries, not just chart count, and rejects unsupported summaries', () => {
  const input = query();
  input.dashboard.items = [
    {
      chart: { name: 'Histogram', metricName: 'custom_duration', unit: 's', dataType: 'histogram' },
    },
    ...Array.from({ length: 3 }, (_, i) => ({
      chart: { ...input.dashboard.items[0].chart, name: `raw-${i}` },
    })),
  ];
  input.histogramSummaries = ['avg', 'p50', 'p90', 'p95', 'p99'];
  expect(customDashboardJobs(input)).toHaveLength(8);
  input.dashboard.items.push({ chart: { ...input.dashboard.items[1].chart, name: 'extra' } });
  expect(() => customDashboardJobs(input)).toThrow('8 metric queries');
  input.dashboard.items = input.dashboard.items.slice(0, 1);
  for (const invalid of [[], ['avg', 'avg'], ['p100']]) {
    Object.assign(input, { histogramSummaries: invalid });
    expect(() => customDashboardJobs(input)).toThrow('1 to 5 distinct');
  }
  expect(() =>
    validateCustomDashboard({
      ...dashboard,
      items: [{ chart: { ...chart, dataType: 'histogram', aggregator: 'max' } }],
    })
  ).toThrow('sum aggregation');
});
it('uses nonempty metrics before the legacy metric field and preserves declared labels', () => {
  const normalized = validateCustomDashboard({
    ...dashboard,
    items: [
      {
        chart: {
          ...chart,
          metricName: 'legacy_metric',
          metrics: [
            { metricName: 'used_bytes', displayName: 'Used' },
            { metricName: 'limit_bytes', displayName: 'Limit' },
          ],
        },
      },
    ],
  });
  expect(customChartMetrics(normalized.items[0].chart)).toEqual([
    { metricName: 'used_bytes', displayName: 'Used' },
    { metricName: 'limit_bytes', displayName: 'Limit' },
  ]);
  const jobs = customDashboardJobs({ ...query(), dashboard: normalized });
  expect(jobs.map(job => job.metric.displayName)).toEqual(['Used', 'Limit']);
  expect(jobs.every(job => !job.expression.includes('legacy_metric'))).toBe(true);
  expect(
    customChartMetrics(
      validateCustomDashboard({ ...dashboard, items: [{ chart: { ...chart, metrics: [] } }] })
        .items[0].chart
    )
  ).toEqual([{ metricName: chart.metricName, displayName: chart.name }]);
});
it('validates metric declarations and counts metric-by-summary expansion before transport', () => {
  const metrics = Array.from({ length: 4 }, (_, i) => ({
    metricName: `metric_${i}`,
    displayName: `Metric ${i}`,
  }));
  const value = validateCustomDashboard({
    ...dashboard,
    items: [{ chart: { ...chart, dataType: 'histogram', metrics } }],
  });
  expect(customDashboardJobs({ ...query(), dashboard: value })).toHaveLength(8);
  value.items[0].chart.metrics!.push({ metricName: 'extra', displayName: 'Extra' });
  expect(() => customDashboardJobs({ ...query(), dashboard: value })).toThrow('8 metric queries');
  for (const invalid of [
    { ...chart, metricName: undefined, metrics: [] },
    { ...chart, metrics: [{ metricName: 'one', displayName: '' }] },
    { ...chart, metrics: [{ metricName: 'one', displayName: '   ' }] },
    {
      ...chart,
      metrics: [
        { metricName: 'one', displayName: 'Same' },
        { metricName: 'two', displayName: 'Same' },
      ],
    },
    { ...chart, metrics: [{ metricName: 'sum(up)', displayName: 'Bad' }] },
    {
      ...chart,
      metrics: Array.from({ length: 9 }, (_, i) => ({
        metricName: `metric_${i}`,
        displayName: `Metric ${i}`,
      })),
    },
  ])
    expect(() => validateCustomDashboard({ ...dashboard, items: [{ chart: invalid }] })).toThrow();
});
it('adds literal equality filters consistently without replacing mandatory scope', () => {
  const input = query();
  input.labelsFilters = { job: 'runtime"\\job', empty: '' };
  const job = customDashboardJobs(input)[0];
  expect(job.expression).toBe(
    'sum(container_memory_working_set_bytes{namespace="bookinfo",cluster="east",empty="",job="runtime\\"\\\\job"})'
  );
  input.dashboard.items[0].chart.dataType = 'rate';
  expect(customDashboardJobs(input)[0].expression).toContain('empty="",job="runtime\\"\\\\job"');
  input.dashboard.items[0].chart.dataType = 'histogram';
  expect(
    customDashboardJobs(input).every(job =>
      job.expression.includes('empty="",job="runtime\\"\\\\job"')
    )
  ).toBe(true);
  for (const key of ['namespace', 'cluster']) {
    input.labelsFilters = { [key]: 'other' };
    expect(() => customDashboardJobs(input)).toThrow('cannot replace');
  }
  for (const invalid of [
    { __name__: 'other' },
    { 'bad-label': 'x' },
    { job: 1 },
    { job: '\ud800' },
    { job: 'line\nbreak' },
    { job: 'x'.repeat(1025) },
    [],
  ]) {
    Object.assign(input, { labelsFilters: invalid });
    expect(() => customDashboardJobs(input)).toThrow();
  }
});
it('enforces exact equality-filter count and encoded query parameter limits', () => {
  const input = query();
  input.labelsFilters = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`key${i}`, 'value'])
  );
  expect(customDashboardJobs(input)).toHaveLength(1);
  input.labelsFilters.extra = 'value';
  expect(() => customDashboardJobs(input)).toThrow('10 equality labels');
  input.labelsFilters = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`key${i}`, '\u00e9'.repeat(1024)])
  );
  expect(() => customDashboardJobs(input)).toThrow('16 KiB');
  const overhead = metricRangeParameters(input, 'x').toString().length - 1;
  expect(metricRangeParameters(input, 'x'.repeat(16384 - overhead)).toString()).toHaveLength(16384);
  expect(() => metricRangeParameters(input, 'x'.repeat(16385 - overhead))).toThrow('16 KiB');
});
