import { MetricResult, prometheusQueries, securityRates } from './telemetry';

const query = {
  namespace: 'bookinfo',
  telemetryCluster: 'east',
  direction: 'outbound' as const,
  minutes: 5 as const,
  end: 10000,
};
function series(labels: Record<string, string>, value: number | null) {
  return { labels, samples: [{ timestamp: 10000, value }] };
}
it('uses destination-reported security telemetry even for outbound workload scope', () => {
  const text = prometheusQueries(query).security;
  expect(text).toContain('request_protocol,connection_security_policy');
  expect(text).toContain(
    'reporter="destination",source_workload_namespace="bookinfo",source_cluster="east"'
  );
  expect(prometheusQueries({ ...query, direction: 'inbound' }).security).toContain(
    'reporter="destination",destination_workload_namespace="bookinfo"'
  );
});
it('keeps unknown observations in the denominator rather than classifying them as plaintext or mTLS', () => {
  const result: MetricResult = {
    warnings: [],
    series: [
      series({ request_protocol: 'http', connection_security_policy: 'mutual_tls' }, 8),
      series({ request_protocol: 'http' }, 1),
      series({ request_protocol: 'http', connection_security_policy: 'unknown' }, 1),
      series({ request_protocol: 'grpc', connection_security_policy: 'none' }, 2),
    ],
  };
  expect(securityRates(result)).toEqual([
    { protocol: 'grpc', policy: 'none', rate: 2, observedPercent: 100 },
    { protocol: 'http', policy: 'mutual_tls', rate: 8, observedPercent: 80 },
    { protocol: 'http', policy: 'unknown', rate: 2, observedPercent: 20 },
  ]);
});
it('keeps zero traffic and empty results unavailable rather than proving a security percentage', () => {
  expect(securityRates({ warnings: [], series: [] })).toEqual([]);
  expect(
    securityRates({
      warnings: [],
      series: [series({ request_protocol: 'http', connection_security_policy: 'mutual_tls' }, 0)],
    })
  ).toEqual([{ protocol: 'http', policy: 'mutual_tls', rate: 0, observedPercent: null }]);
});
it.each([null, -1, NaN, Infinity])('rejects invalid rate %j', rate => {
  expect(() =>
    securityRates({ warnings: [], series: [series({ request_protocol: 'http' }, rate)] })
  ).toThrow();
});
it('rejects duplicate aggregated series rather than inflating observations', () => {
  const entry = series({ request_protocol: 'http', connection_security_policy: 'mutual_tls' }, 1);
  expect(() => securityRates({ warnings: [], series: [entry, entry] })).toThrow('Duplicate');
});
