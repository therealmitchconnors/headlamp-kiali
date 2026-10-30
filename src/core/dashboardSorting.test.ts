import {
  customDashboardJobs,
  CustomDashboardQuery,
  validateCustomDashboard,
} from './customDashboards';
import { filterAggregationValues } from './dashboardAggregations';
import { sortDashboardSeries, validateDashboardSorting } from './dashboardSorting';
import { groupedMetricComparisons } from './metricComparison';
import { MetricResult } from './telemetry';

function result(values: string[]): MetricResult {
  return {
    warnings: [],
    series: values.map((rank, i) => ({
      labels: { rank, pod: `p${i}` },
      samples: [{ timestamp: 10000, value: i }],
    })),
  };
}
const query = (): CustomDashboardQuery => ({
  namespace: 'bookinfo',
  metricCluster: 'east',
  singleClusterConfirmed: false,
  namespaceLabel: 'namespace',
  clusterLabel: 'cluster',
  minutes: 15,
  end: 10000,
  dashboard: {
    name: 'sorting',
    title: 'Sorted',
    items: [
      {
        chart: {
          name: 'Memory',
          metricName: 'memory',
          dataType: 'raw',
          groupLabels: ['pod'],
          sortLabel: 'rank',
        },
      },
    ],
  },
});
it('sorts lexically using Go UTF-8 order without mutating samples or the captured input', () => {
  const input = result(['10', '2', '\u{10000}', '\uE000']);
  const original = structuredClone(input);
  const sorted = sortDashboardSeries(input, { sortLabel: 'rank' }, ['pod', 'rank']);
  expect(sorted.series.map(series => series.labels.rank)).toEqual([
    '10',
    '2',
    '\uE000',
    '\u{10000}',
  ]);
  expect(sorted.series.map(series => series.samples[0].value)).toEqual([0, 1, 3, 2]);
  expect(input).toEqual(original);
});
it('compares exact signed int64 values beyond JavaScript safe integer precision', () => {
  const input = result([
    '9223372036854775807',
    '-9223372036854775808',
    '9007199254740993',
    '9007199254740992',
    '-9007199254740992',
    '-9007199254740993',
    '+0002',
    '-0',
  ]);
  expect(
    sortDashboardSeries(input, { sortLabel: 'rank', sortLabelParseAs: 'int' }, [
      'pod',
      'rank',
    ]).series.map(series => series.labels.rank)
  ).toEqual([
    '-9223372036854775808',
    '-9007199254740993',
    '-9007199254740992',
    '-0',
    '+0002',
    '9007199254740992',
    '9007199254740993',
    '9223372036854775807',
  ]);
});
it('preserves equal numeric keys in observed order and removes only automatically added labels', () => {
  const input = result(['2', '+02', '1']);
  const sorted = sortDashboardSeries(input, { sortLabel: 'rank', sortLabelParseAs: 'int' }, [
    'pod',
  ]);
  expect(sorted.series.map(series => series.labels)).toEqual([
    { pod: 'p2' },
    { pod: 'p0' },
    { pod: 'p1' },
  ]);
  const choices = new Map([['pod', new Map([['p0', false]])]]);
  const filtered = filterAggregationValues(sorted, choices);
  const comparisons = groupedMetricComparisons([{ name: 'M', result: filtered }], ['pod'], true);
  expect(comparisons.map(metric => metric.group)).toEqual(['{pod="p2"}', '{pod="p1"}']);
  expect(
    groupedMetricComparisons([{ name: 'M', result: sorted }], ['pod']).map(metric => metric.group)
  ).toEqual(['{pod="p0"}', '{pod="p1"}', '{pod="p2"}']);
});
it.each([
  '',
  ' ',
  '1.0',
  '1e2',
  'NaN',
  '0x10',
  '1_0',
  '1\n',
  '9223372036854775808',
  '-9223372036854775809',
])('rejects invalid integer values instead of silently sorting %s as zero', value => {
  expect(() =>
    sortDashboardSeries(result([value]), { sortLabel: 'rank', sortLabelParseAs: 'int' }, ['pod'])
  ).toThrow(/Integer dashboard sort values/);
});
it('sorts absent lexical labels as empty but rejects indistinguishable converted groups', () => {
  const input = result(['b', 'a']);
  delete input.series[0].labels.rank;
  expect(sortDashboardSeries(input, { sortLabel: 'rank' }, ['pod']).series[0].labels.pod).toBe(
    'p0'
  );
  input.series[0].labels.rank = 'b';
  input.series[1].labels.pod = 'p0';
  expect(() => sortDashboardSeries(input, { sortLabel: 'rank' }, ['pod'])).toThrow(
    'indistinguishable'
  );
  expect(() => sortDashboardSeries(result(['1', '2']), { sortLabel: 'rank' }, [])).toThrow(
    'undeclared'
  );
});
it.each([
  { sortLabel: 4 },
  { sortLabel: 'bad-label' },
  { sortLabel: '__name__' },
  { sortLabel: 'rank', sortLabelParseAs: 'float' },
  { sortLabelParseAs: 'int' },
])('rejects unsupported sorting declarations %j', value => {
  expect(() => validateDashboardSorting(value)).toThrow();
});
it('normalizes absent sorting and excludes the reserved histogram bucket label', () => {
  expect(validateDashboardSorting({ sortLabel: null, sortLabelParseAs: '' })).toEqual({});
  expect(() => validateDashboardSorting({ sortLabel: 'le' }, true)).toThrow('le');
  const value = query();
  value.dashboard.items[0].chart.sortLabelParseAs = 'int';
  expect(validateCustomDashboard(value.dashboard).items[0].chart).toMatchObject({
    sortLabel: 'rank',
    sortLabelParseAs: 'int',
  });
});
it.each(['raw', 'rate', 'histogram'] as const)(
  'includes sort-only grouping in every %s request, not the display groups',
  dataType => {
    const input = query();
    input.dashboard.items[0].chart.dataType = dataType;
    const jobs = customDashboardJobs(input);
    expect(jobs).toHaveLength(dataType === 'histogram' ? 2 : 1);
    expect(
      jobs.every(job => job.expression.includes(dataType === 'histogram' ? 'by (' : ' by ('))
    ).toBe(true);
    for (const job of jobs) {
      expect(job.queryGroupLabels).toEqual(['pod', 'rank']);
      expect(job.groupLabels).toEqual(['pod']);
      expect(job.expression).toContain('rank');
    }
  }
);
it('does not duplicate a fixed/optional sort label and does not raise the total group budget', () => {
  const input = query();
  input.dashboard.items[0].chart.aggregations = [{ label: 'rank', displayName: 'Rank' }];
  input.byLabels = ['rank'];
  expect(customDashboardJobs(input)[0].groupLabels).toEqual(['pod', 'rank']);
  expect(customDashboardJobs(input)[0].queryGroupLabels).toEqual(['pod', 'rank']);
  input.byLabels = [];
  input.dashboard.items[0].chart.groupLabels = ['a', 'b', 'c', 'd'];
  expect(() => customDashboardJobs(input)).toThrow('4 distinct');
});
