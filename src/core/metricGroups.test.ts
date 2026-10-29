import { validateCustomDashboard } from './customDashboards';
import { histogramExpressions } from './histograms';
import { groupedMetricComparisons, metricComparisonData } from './metricComparison';
import { metricGroupIdentity, metricGroupLabels } from './metricGroups';
import { decodeGroupedRange, decodeScalarRange, MetricTimeRange } from './metricRanges';
import { MetricResult } from './telemetry';

const query: MetricTimeRange = { minutes: 60, end: 10000 };
const entry = (metric: Record<string, string>, values: [number, string][] = [[10000, '1']]) => ({
  metric,
  values,
});
const matrix = (result: ReturnType<typeof entry>[]) => ({
  status: 'success',
  data: { resultType: 'matrix', result },
});
const decode = (result: ReturnType<typeof entry>[], groups = ['pod'], nonnegative = false) =>
  decodeGroupedRange(matrix(result), query, 'Grouped chart', nonnegative, groups);
it('preserves ordered group names, explicit empty groups and detached settings', () => {
  const groups = ['revision', 'pod'];
  const normalized = metricGroupLabels(groups);
  groups.push('changed');
  expect(normalized).toEqual(['revision', 'pod']);
  expect(metricGroupLabels(undefined)).toEqual([]);
  expect(metricGroupLabels(null)).toEqual([]);
  expect(metricGroupLabels(['a'.repeat(253), 'b', 'c', 'd'])).toHaveLength(4);
  const dashboard = validateCustomDashboard({
    name: 'd',
    title: 'D',
    items: [
      {
        chart: {
          name: 'C',
          metricName: 'm',
          dataType: 'raw',
          unit: 'bytes',
          groupLabels: ['pod'],
        },
      },
    ],
  });
  expect(dashboard.items[0].chart.groupLabels).toEqual(['pod']);
});
it.each(
  [
    'pod',
    ['pod', 'pod'],
    ['bad-label'],
    ['a', 'b', 'c', 'd', 'e'],
    ['__name__'],
    ['a'.repeat(254), 'b', 'c', 'd'],
    ['x) or vector(1)'],
    ['pod\n'],
    [1],
  ].map(groups => ({ groups }))
)('rejects invalid grouping declarations %#', ({ groups }) => {
  expect(() => metricGroupLabels(groups)).toThrow('grouping requires');
});
it('reserves le only for histograms and retains grouping on both histogram operands', () => {
  expect(metricGroupLabels(['le'])).toEqual(['le']);
  expect(() => histogramExpressions('h', {}, ['avg'], ['le'])).toThrow('reserved le');
  expect(
    histogramExpressions('h', { namespace: 'bookinfo' }, ['avg', 'p95'], ['pod', 'revision'])
  ).toEqual([
    {
      summary: 'avg',
      expression:
        'sum(rate(h_sum{namespace="bookinfo"}[5m])) by (pod,revision) / sum(rate(h_count{namespace="bookinfo"}[5m])) by (pod,revision)',
    },
    {
      summary: 'p95',
      expression:
        'histogram_quantile(0.95, sum(rate(h_bucket{namespace="bookinfo"}[5m])) by (le,pod,revision))',
    },
  ]);
});
it('keeps eight independent 241-sample groups, zeros, signs and nonfinite gaps', () => {
  const result = decode(
    Array.from({ length: 8 }, (_, group) =>
      entry(
        { pod: `p${group}` },
        Array.from({ length: 241 }, (_, i) => [
          6400 + i * 15,
          i === 0 ? '-2' : i === 1 ? '0' : i === 2 ? 'NaN' : '1',
        ])
      )
    )
  );
  expect(result.series).toHaveLength(8);
  expect(result.series[0].samples).toHaveLength(241);
  expect(result.series[0].samples.slice(0, 3).map(sample => sample.value)).toEqual([-2, 0, null]);
  expect(result.series[0].labels).toEqual({ pod: 'p0' });
  expect(() => decode(Array.from({ length: 9 }, (_, i) => entry({ pod: `p${i}` })))).toThrow(
    'more than 8'
  );
  expect(() =>
    decode([
      entry(
        { pod: 'p' },
        Array.from({ length: 242 }, (_, i) => [6400 + i * 15, '1'])
      ),
    ])
  ).toThrow('sample budget');
});
it('preserves strict scalar decoding when no grouping is declared', () => {
  const input = matrix([entry({}, [[10000, '0']])]);
  expect(decodeGroupedRange(input, query, 'Chart', false, [])).toEqual(
    decodeScalarRange(input, query, 'Chart', false)
  );
  expect(() => decode([entry({ pod: 'p' })], [])).toThrow('aggregation labels');
  expect(() => decode([entry({}), entry({})], [])).toThrow('multiple series');
});
it('rejects undeclared dimensions, duplicate groups and absent/empty-equivalent groups', () => {
  expect(() => decode([entry({ pod: 'p', other: 'x' })])).toThrow('undeclared grouping');
  expect(() => decode([entry({ pod: 'p' }), entry({ pod: 'p' })])).toThrow('duplicate');
  expect(() => decode([entry({}), entry({ pod: '' })])).toThrow('duplicate');
  expect(() => decode([entry({ a: '1', b: '2' }), entry({ b: '2', a: '1' })], ['a', 'b'])).toThrow(
    'duplicate'
  );
  expect(decode([entry({})]).series[0].labels).toEqual({});
});
it('enforces value and caption limits without truncating or colliding missing values', () => {
  const groups = ['a', 'b', 'c', 'd'];
  const labels = Object.fromEntries(groups.map(name => [name, 'x'.repeat(250)]));
  expect(metricGroupIdentity(labels, groups).caption).toHaveLength(1024);
  expect(() => metricGroupIdentity({ ...labels, a: 'x'.repeat(251) }, groups)).toThrow('1024');
  expect(() => decode([entry({ pod: 'x'.repeat(257) })])).toThrow('256');
  expect(() => decode([entry({ pod: '\ud800' })])).toThrow('surrogates');
  expect(metricGroupIdentity({ a: '', b: '<absent>', c: '"\n\\' }, groups).caption).toBe(
    '{a="", b="<absent>", c="\\"\\n\\\\", d=<absent>}'
  );
  expect(metricGroupIdentity({}, ['constructor']).caption).toBe('{constructor=<absent>}');
  const prototypeLabel = JSON.parse('{"__proto__":"literal"}');
  expect(metricGroupIdentity(prototypeLabel, ['__proto__']).caption).toBe('{__proto__="literal"}');
});
it.each(
  [
    [[6398, '1']],
    [[10002, '1']],
    [[10000, 'bad']],
    [
      [10000, '1'],
      [10000, '2'],
    ],
  ].map(values => ({ values: values as [number, string][] }))
)('rejects invalid grouped samples %#', ({ values }) => {
  expect(() => decode([entry({ pod: 'p' }, values)])).toThrow();
});
it('preserves provider errors and warnings and rejects negative counter rates', () => {
  expect(() =>
    decodeGroupedRange({ status: 'error', error: 'provider denied' }, query, 'Chart', false, [
      'pod',
    ])
  ).toThrow('provider denied');
  expect(
    decodeGroupedRange({ ...matrix([]), warnings: ['partial data'] }, query, 'Chart', false, [
      'pod',
    ]).warnings
  ).toEqual(['partial data']);
  expect(() => decode([entry({ pod: 'p' }, [[10000, '-1']])], ['pod'], true)).toThrow(
    'nonnegative'
  );
  expect(
    decode([entry({ pod: 'p' }, [[10000, 'NaN']])], ['pod'], true).series[0].samples[0].value
  ).toBeNull();
});
const grouped = (name: string, values: { pod: string; timestamp?: number; value?: number }[]) => ({
  name,
  result: {
    warnings: [],
    series: values.map(({ pod, timestamp = 1, value = 2 }) => ({
      labels: { pod },
      samples: [{ timestamp, value }],
    })),
  } satisfies MetricResult,
});
it('sorts groups deterministically and compares named groups without adding samples or filling gaps', () => {
  const input = [
    grouped('Used', [
      { pod: 'z', value: -2 },
      { pod: 'a', timestamp: 2, value: 0 },
    ]),
  ];
  const snapshot = structuredClone(input);
  const comparisons = groupedMetricComparisons(input, ['pod']);
  const data = metricComparisonData(comparisons);
  expect(data.series.map(series => series.name)).toEqual(['"Used" {pod="a"}', '"Used" {pod="z"}']);
  expect(data.rows).toEqual([
    { timestamp: 1, series0: null, series1: -2 },
    { timestamp: 2, series0: 0, series1: null },
  ]);
  input[0].result.series.reverse();
  expect(metricComparisonData(groupedMetricComparisons(input, ['pod']))).toEqual(data);
  input[0].result.series.reverse();
  expect(input).toEqual(snapshot);
});
it('bounds combined metric/group display cardinality independently from request count', () => {
  const groups = Array.from({ length: 4 }, (_, i) => ({ pod: `p${i}` }));
  const inputs = [grouped('A', groups), grouped('B', groups)];
  expect(metricComparisonData(groupedMetricComparisons(inputs, ['pod'])).series).toHaveLength(8);
  inputs[1].result.series.push({ labels: { pod: 'extra' }, samples: [] });
  expect(() => groupedMetricComparisons(inputs, ['pod'])).toThrow('8 displayed series');
  expect(() =>
    groupedMetricComparisons([grouped('A', [{ pod: 'a' }, { pod: 'a' }])], ['pod'])
  ).toThrow('duplicate');
  expect(groupedMetricComparisons([grouped('Empty', [])], ['pod'])).toEqual([]);
});
