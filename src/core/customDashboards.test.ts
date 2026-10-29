import oracleText from '../../test-files/parity/custom-dashboard-query-oracle.json?raw';
import {
  customDashboardJobs,
  CustomDashboardQuery,
  validateCustomDashboard,
  validateCustomDashboardSettings,
} from './customDashboards';
const oracle: {
  cases: {
    input: {
      namespace: string;
      namespaceLabel: string;
      clusterLabel: string | null;
      metricCluster: string;
      chart: CustomDashboardQuery['dashboard']['items'][number]['chart'];
    };
    expected: string;
  }[];
} = JSON.parse(oracleText);
it.each(oracle.cases)(
  'matches original custom raw/rate query construction %#',
  ({ input, expected }) => {
    expect(
      customDashboardJobs({
        ...input,
        minutes: 15,
        end: 10000,
        singleClusterConfirmed: true,
        dashboard: { name: 'runtime', title: 'Runtime', items: [{ chart: input.chart }] },
      })[0].expression
    ).toBe(expected);
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
  { ...dashboard, items: [{ chart: { ...chart, dataType: 'histogram' } }] },
  { ...dashboard, items: [{ chart: { ...chart, groupLabels: ['pod'] } }] },
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
