import { ComparisonMetric, metricComparisonData } from './metricComparison';
const metric = (name: string, values: [number, number | null][]): ComparisonMetric => ({
  name,
  result: {
    warnings: [],
    series: [{ labels: {}, samples: values.map(([timestamp, value]) => ({ timestamp, value })) }],
  },
});
it('aligns timestamps without summing values, filling missing points with null rather than zero', () => {
  const data = metricComparisonData([
    metric('Used', [
      [1, -2],
      [3, 0],
    ]),
    metric('Limit', [
      [2, 10],
      [3, null],
    ]),
  ]);
  expect(data.series).toEqual([
    { name: 'Used', key: 'series0', colorIndex: 0 },
    { name: 'Limit', key: 'series1', colorIndex: 1 },
  ]);
  expect(data.rows).toEqual([
    { timestamp: 1, series0: -2, series1: null },
    { timestamp: 2, series0: null, series1: 10 },
    { timestamp: 3, series0: 0, series1: null },
  ]);
});
it('preserves declared color positions when a sibling metric fails', () => {
  expect(
    metricComparisonData([{ ...metric('Limit', [[1, 2]]), colorIndex: 1 }]).series[0].colorIndex
  ).toBe(1);
  expect(() =>
    metricComparisonData([
      { ...metric('A', []), colorIndex: 1 },
      { ...metric('B', []), colorIndex: 1 },
    ])
  ).toThrow('colors');
});
it('bounds metrics and samples while keeping empty and unavailable series explicit', () => {
  const metrics = Array.from({ length: 8 }, (_, i) =>
    metric(
      `metric${i}`,
      Array.from({ length: 241 }, (_, j) => [j * 8 + i, j])
    )
  );
  expect(metricComparisonData(metrics).rows).toHaveLength(1928);
  expect(() => metricComparisonData([...metrics, metric('extra', [])])).toThrow('1 to 8');
  expect(() =>
    metricComparisonData([
      metric(
        'extra',
        Array.from({ length: 242 }, (_, j) => [j, 1])
      ),
    ])
  ).toThrow('bounded scalar');
  expect(
    metricComparisonData([metric('empty', []), metric('unavailable', [[1, null]])]).rows
  ).toEqual([{ timestamp: 1, series0: null, series1: null }]);
});
it('rejects malformed comparison identity, aggregate dimensions and samples', () => {
  for (const data of [
    [metric('a', []), metric('a', [])],
    [metric('', [])],
    [metric('   ', [])],
    [
      metric('a', [
        [1, 1],
        [1, 2],
      ]),
    ],
    [metric('a', [[NaN, 1]])],
    [metric('a', [[1, Infinity]])],
    [
      {
        name: 'a',
        result: { warnings: [], series: [{ labels: { leftover: 'dimension' }, samples: [] }] },
      },
    ],
  ])
    expect(() => metricComparisonData(data)).toThrow();
});
