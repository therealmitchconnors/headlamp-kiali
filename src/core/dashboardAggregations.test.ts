import {
  CustomDashboard,
  customDashboardJobs,
  CustomDashboardQuery,
  validateCustomDashboard,
} from './customDashboards';
import {
  aggregationValueOptions,
  dashboardAggregationOptions,
  dashboardByLabels,
  filterAggregationValues,
  initialAggregationChoices,
  selectAggregationValue,
  validateDashboardAggregations,
} from './dashboardAggregations';
import { MetricResult } from './telemetry';

const dashboard = (declarations: unknown[][]): CustomDashboard =>
  validateCustomDashboard({
    name: 'd',
    title: 'D',
    items: declarations.map((aggregations, index) => ({
      chart: {
        name: `Chart ${index}`,
        metricName: `m${index}`,
        dataType: 'raw',
        aggregations,
      },
    })),
  });
const query = (definition: CustomDashboard): CustomDashboardQuery => ({
  namespace: 'bookinfo',
  namespaceLabel: 'namespace',
  metricCluster: 'east',
  clusterLabel: 'cluster',
  singleClusterConfirmed: false,
  minutes: 15,
  end: 10000,
  dashboard: definition,
});
const option = (label: string, displayName = label, singleSelection = false) => ({
  label,
  displayName,
  singleSelection,
});
it('preserves declaration defaults and pinned display-name overwrite then label-map ordering', () => {
  expect(validateDashboardAggregations([{ label: 'pod', displayName: 'Pod' }])).toEqual([
    option('pod', 'Pod'),
  ]);
  expect(
    dashboardAggregationOptions(dashboard([[option('pod', 'Group')], [option('zone', 'Group')]]))
  ).toEqual([option('zone', 'Group')]);
  expect(
    dashboardAggregationOptions(
      dashboard([[option('pod', 'A'), option('zone', 'B'), option('pod', 'Z')]])
    )
  ).toEqual([option('pod', 'Z'), option('zone', 'B')]);
  expect(
    dashboardAggregationOptions(
      dashboard([[option('astral', '\u{10000}'), option('bmp', '\ue000')]])
    ).map(item => item.label)
  ).toEqual(['bmp', 'astral']);
});
it.each(
  [
    [{ label: 'bad-label', displayName: 'Bad' }],
    [{ label: '__name__', displayName: 'Name' }],
    [{ label: 'pod', displayName: '' }],
    [{ label: 'pod', displayName: '\ud800' }],
    [{ label: 'pod', displayName: 'Pod', singleSelection: 1 }],
    [{ label: 'pod', displayName: 'Pod', unexpected: true }],
    Array.from({ length: 9 }, (_, i) => option(`p${i}`)),
  ].map(input => ({ input }))
)('rejects invalid aggregation declarations %#', ({ input }) => {
  expect(() => validateDashboardAggregations(input)).toThrow();
});
it('rejects conflicting alias selection modes and bounds the option surface', () => {
  expect(() =>
    dashboardAggregationOptions(dashboard([[option('pod', 'A', true), option('pod', 'B', false)]]))
  ).toThrow('agree');
  const declarations = Array.from({ length: 4 }, (_, i) =>
    Array.from({ length: 8 }, (_, j) => option(`p${i}_${j}`))
  );
  expect(dashboardAggregationOptions(dashboard(declarations))).toHaveLength(32);
  expect(() =>
    dashboardAggregationOptions(dashboard([...declarations, [option('extra')]]))
  ).toThrow('32');
});
it('adds only declared optional labels after fixed grouping, without changing filters or query count', () => {
  const definition = dashboard([[option('pod', 'Pod')], [option('pod', 'Pod')]]);
  definition.items[0].chart.groupLabels = ['revision'];
  definition.items[1].chart.dataType = 'histogram';
  const input = { ...query(definition), byLabels: ['pod'], labelsFilters: { job: 'runtime' } };
  const jobs = customDashboardJobs(input);
  expect(jobs).toHaveLength(3);
  expect(jobs[0].groupLabels).toEqual(['revision', 'pod']);
  expect(jobs[0].chart.groupLabels).toEqual(['revision']);
  expect(jobs[0].expression).toBe(
    'sum(m0{namespace="bookinfo",cluster="east",job="runtime"}) by (revision,pod)'
  );
  expect(jobs[1].expression).toContain(' by (pod) / ');
  expect(jobs[2].expression).toContain(' by (le,pod)');
  expect(() => dashboardByLabels(['undeclared'], definition)).toThrow('declared');
  expect(() => customDashboardJobs({ ...input, byLabels: ['pod', 'pod'] })).toThrow('distinct');
  definition.items[0].chart.groupLabels = ['pod'];
  expect(() => customDashboardJobs(input)).toThrow('distinct');
});
it('enforces combined grouping and histogram bucket-label budgets before transport', () => {
  const definition = dashboard([[option('pod'), option('le')]]);
  definition.items[0].chart.groupLabels = ['a', 'b', 'c', 'd'];
  expect(() => customDashboardJobs({ ...query(definition), byLabels: ['pod'] })).toThrow(
    '4 distinct'
  );
  definition.items[0].chart.groupLabels = [];
  definition.items[0].chart.dataType = 'histogram';
  expect(() => customDashboardJobs({ ...query(definition), byLabels: ['le'] })).toThrow(
    'reserved le'
  );
});
const result = (values: (string | undefined)[]): MetricResult => ({
  warnings: ['retained warning'],
  series: values.map(value => ({
    labels: value === undefined ? {} : { pod: value },
    samples: [{ timestamp: 10000, value: 1 }],
  })),
});
it('uses first observed single-selection values and immutable prototype-safe local choices', () => {
  const source = result(['b', 'a', '__proto__', undefined]);
  const snapshot = structuredClone(source);
  const values = aggregationValueOptions(dashboard([[option('pod', 'Pod', true)]]), [
    source,
    result(['']),
  ]);
  expect(values[0].values).toEqual(['b', 'a', '__proto__', '']);
  const initial = initialAggregationChoices(values);
  expect(filterAggregationValues(source, initial).series.map(series => series.labels)).toEqual([
    { pod: 'b' },
    {},
  ]);
  const selected = selectAggregationValue(initial, values[0], '__proto__', true);
  expect(filterAggregationValues(source, selected).series.map(series => series.labels)).toEqual([
    { pod: '__proto__' },
    {},
  ]);
  expect(initial.get('pod')?.get('b')).toBe(true);
  expect(source).toEqual(snapshot);
  expect(() => selectAggregationValue(selected, values[0], '__proto__', false)).toThrow('requires');
  expect(() => selectAggregationValue(selected, values[0], 'unknown', true)).toThrow('captured');
});
it('keeps absent and unmentioned values visible while hiding only explicit false choices', () => {
  const source = result(['a', 'b', undefined]);
  const values = aggregationValueOptions(dashboard([[option('pod', 'Pod')]]), [source]);
  const initial = initialAggregationChoices(values);
  const changed = selectAggregationValue(initial, values[0], 'a', false);
  const hidden = selectAggregationValue(changed, values[0], 'b', false);
  expect(filterAggregationValues(source, hidden).series.map(series => series.labels)).toEqual([{}]);
  expect(filterAggregationValues(result(['new']), hidden).series).toHaveLength(1);
  expect(filterAggregationValues(source, hidden).warnings).toEqual(['retained warning']);
  expect(initial.get('pod')?.get('a')).toBe(true);
});
it('bounds observed labels and values by captured result cardinality', () => {
  const source = Array.from({ length: 8 }, (_, i) =>
    result(Array.from({ length: 8 }, (_, j) => `p${i}_${j}`))
  );
  const definition = dashboard([[option('pod')]]);
  expect(aggregationValueOptions(definition, source)[0].values).toHaveLength(64);
  expect(() => aggregationValueOptions(definition, [...source, result(['extra'])])).toThrow(
    'budget'
  );
  expect(() => aggregationValueOptions(definition, [result(Array(9).fill('a'))])).toThrow('budget');
});
