import oracleText from '../../test-files/parity/traffic-signals-oracle.json?raw';
import { prometheusQueries } from './telemetry';
import {
  decodeTrafficSignal,
  SignalQuery,
  TRAFFIC_SIGNAL_KEYS,
  TRAFFIC_SIGNALS,
  trafficSignalQueries,
} from './trafficSignals';

const query: SignalQuery = {
  namespace: 'bookinfo',
  telemetryCluster: 'Kubernetes',
  direction: 'inbound',
  minutes: 15,
  end: 10000,
  signals: [...TRAFFIC_SIGNAL_KEYS],
};
const oracle: {
  cases: {
    input: SignalQuery;
    expected: { key: keyof typeof TRAFFIC_SIGNALS; metric: string; expression: string }[];
  }[];
} = JSON.parse(oracleText);
it.each(oracle.cases)(
  'matches original-Go signal definitions and rate queries %#',
  ({ input, expected }) => {
    expect(trafficSignalQueries(input)).toEqual(
      expected.map(({ key, expression }) => ({ key, expression }))
    );
    for (const { key, metric } of expected) expect(TRAFFIC_SIGNALS[key].metric).toBe(metric);
  }
);
it('preserves pinned TCP compensation without silently changing the existing raw TCP chart', () => {
  expect(TRAFFIC_SIGNALS.tcp_sent.metric).toBe('istio_tcp_received_bytes_total');
  expect(TRAFFIC_SIGNALS.tcp_received.metric).toBe('istio_tcp_sent_bytes_total');
  expect(prometheusQueries(query).tcp).toContain('istio_tcp_sent_bytes_total');
  expect(TRAFFIC_SIGNALS.grpc_sent.unit).toBe('messages/s');
  expect(TRAFFIC_SIGNALS.tcp_opened.unit).toBe('connections/s');
});
it.each(
  [[], ['tcp_sent', 'tcp_sent'], ['unknown'], Array(9).fill('tcp_sent')].map(signals => ({
    signals,
  }))
)('rejects invalid signal selection $signals', ({ signals }) => {
  const invalid = structuredClone(query);
  Object.assign(invalid, { signals });
  expect(() => trafficSignalQueries(invalid)).toThrow('distinct available');
});
it.each([0, 900, 10000.5, Infinity, 8640000000001])('rejects invalid captured end %s', end => {
  expect(() => trafficSignalQueries({ ...query, end })).toThrow();
});
const matrix = (values: [number, string][], labels = {}) => ({
  status: 'success',
  warnings: ['retained warning'],
  data: { resultType: 'matrix', result: [{ metric: labels, values }] },
});
it('keeps zero, sparse samples and non-finite gaps distinct', () => {
  expect(
    decodeTrafficSignal(
      matrix([
        [9985, 'NaN'],
        [10000, '0'],
      ]),
      query
    )
  ).toMatchObject({
    warnings: ['retained warning'],
    series: [
      {
        labels: {},
        samples: [
          { timestamp: 9985, value: null },
          { timestamp: 10000, value: 0 },
        ],
      },
    ],
  });
  expect(
    decodeTrafficSignal({ status: 'success', data: { resultType: 'matrix', result: [] } }, query)
      .series
  ).toEqual([]);
});
it('rejects additional dimensions, negative values, oversized matrices and samples outside the captured window', () => {
  for (const value of [
    matrix([[10000, '1']], { unexpected: 'label' }),
    matrix([[10000, '-1']]),
    matrix([[10002, '1']]),
    matrix([[9098, '1']]),
    matrix(Array.from({ length: 62 }, (_, index) => [9100 + index * 14, '1'])),
  ])
    expect(() => decodeTrafficSignal(value, query)).toThrow();
  const boundary = matrix(Array.from({ length: 61 }, (_, index) => [9100 + index * 15, '1']));
  expect(decodeTrafficSignal(boundary, query).series[0].samples).toHaveLength(61);
});
