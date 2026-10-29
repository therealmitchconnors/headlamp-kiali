import fixtureText from '../../test-files/parity/health-reporters-oracle.json?raw';
import { RequestHealth } from './health';
import {
  combinedMetricHealth,
  combineReportedRequests,
  ReportedRequestRate,
  requestHealthCode,
} from './healthReporters';
import { workloadHealthQueries } from './workloadHealth';

const fixtures: {
  commit: string;
  cases: {
    input: { inbound: ReportedRequestRate[]; outbound: ReportedRequestRate[] };
    expected: RequestHealth;
  }[];
} = JSON.parse(fixtureText);
it('retains the pinned reporter oracle identity and count', () => {
  expect(fixtures.commit).toBe('0e8be887b8217bbcac5e3ae0bfcd258073949cca');
  expect(fixtures.cases).toHaveLength(372);
});
it.each(fixtures.cases)('matches original Go reporter aggregation %#', ({ input, expected }) => {
  expect(combineReportedRequests(input.inbound, input.outbound)).toEqual(expected);
});
it('gives no-response codes priority over a successful gRPC status and preserves the HTTP fallback', () => {
  expect(
    requestHealthCode({ request_protocol: 'grpc', response_code: '0', grpc_response_status: '0' })
  ).toBe('-');
  expect(requestHealthCode({ request_protocol: 'grpc', response_code: '200' })).toBe('200');
  expect(
    requestHealthCode({
      request_protocol: 'grpc',
      response_code: '200',
      grpc_response_status: '13',
    })
  ).toBe('13');
});
it('keeps the existing single reporter query contract and explicitly tags combined results', () => {
  const query = {
    kind: 'Deployment' as const,
    namespace: 'bookinfo',
    name: 'reviews-v1',
    telemetryCluster: 'east',
    end: 10000,
  };
  const single = workloadHealthQueries(query);
  expect(single.inbound).toContain('{reporter="destination",');
  expect(single.inbound).not.toContain('sum by (reporter,');
  const combined = workloadHealthQueries({ ...query, reporterMode: 'combined' });
  expect(combined.inbound).toContain('sum by (reporter,');
  expect(combined.inbound).not.toContain('reporter=');
  expect(combined.outbound).toContain('{reporter="source",');
  expect(combined.outbound).toContain('sum by (reporter,');
});
it('refuses malformed/ambiguous consumer data without discarding the low-level legacy oracle behavior', () => {
  const result = {
    warnings: [],
    series: [
      {
        labels: { request_protocol: 'http', response_code: '200' },
        samples: [{ timestamp: 10000, value: 1 }],
      },
    ],
  };
  expect(() => combinedMetricHealth(result)).toThrow('reporter labels');
  expect(() => combineReportedRequests([{ labels: {}, value: -1 }], [])).toThrow('nonnegative');
  expect(() =>
    combineReportedRequests(
      Array.from({ length: 4001 }, () => ({ labels: {}, value: 1 })),
      []
    )
  ).toThrow('4,000');
});
