import oracleText from '../../test-files/parity/histogram-oracle.json?raw';
import { decodeHistogram, histogramQueries,HistogramQuery } from './histograms';

const oracle: { cases: { input: HistogramQuery; expected: Record<string, string> }[] } =
  JSON.parse(oracleText);
const query: HistogramQuery = {
  namespace: 'bookinfo',
  telemetryCluster: 'Kubernetes',
  direction: 'inbound',
  minutes: 15,
  end: 10000,
  metric: 'duration',
  summaries: ['avg', 'p95'],
};
it.each(oracle.cases)(
  'matches original Go histogram query construction %#',
  ({ input, expected }) => {
    expect(
      Object.fromEntries(histogramQueries(input).map(item => [item.summary, item.expression]))
    ).toEqual(expected);
  }
);
it('rejects unsafe metric/scope, unsupported summaries and impossible captured ranges', () => {
  for (const changes of [
    { namespace: '../bad' },
    { summaries: [] },
    { summaries: ['p95', 'p95'] },
    { metric: '__proto__' },
    { metric: 'raw_query' },
    { summaries: ['p100'] },
    { end: 10 },
  ]) {
    const invalid = structuredClone(query);
    Object.assign(invalid, changes);
    expect(() => histogramQueries(invalid)).toThrow();
  }
});
const result = (values: unknown[], labels = {}) => ({
  status: 'success',
  data: { resultType: 'matrix', result: [{ metric: labels, values }] },
});
it('preserves non-finite gaps and explicit zero without extrapolating beyond captured data', () => {
  const value = decodeHistogram(
    result([
      [9985, 'NaN'],
      [10000, '0'],
    ]),
    query
  );
  expect(value.series[0].samples).toEqual([
    { timestamp: 9985, value: null },
    { timestamp: 10000, value: 0 },
  ]);
});
it('enforces aggregation, nonnegative values and exact range/sample budgets', () => {
  for (const response of [
    result([[10000, '-1']]),
    result([[10002, '1']]),
    result([[9000, '1']]),
    result([[10000, '1']], { source_cluster: 'other' }),
    {
      status: 'success',
      data: {
        resultType: 'matrix',
        result: [
          { metric: {}, values: [] },
          { metric: {}, values: [] },
        ],
      },
    },
  ])
    expect(() => decodeHistogram(response, query)).toThrow();
  const samples = Array.from({ length: 61 }, (_, index) => [9100 + index * 15, '1']);
  expect(decodeHistogram(result(samples), query).series[0].samples).toHaveLength(61);
  expect(() =>
    decodeHistogram(result(Array.from({ length: 62 }, (_, index) => [9100 + index, '1'])), query)
  ).toThrow('sample budget');
});
