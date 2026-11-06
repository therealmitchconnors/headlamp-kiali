import { MetricResult, prometheusQueries, securityTelemetry } from './telemetry';

const query = {
  namespace: 'bookinfo',
  telemetryCluster: 'east',
  direction: 'outbound' as const,
  minutes: 15 as const,
  end: 10000,
};
function series(labels: Record<string, string>, samples: [number, number | null][]) {
  return { labels, samples: samples.map(([timestamp, value]) => ({ timestamp, value })) };
}
function result(series: MetricResult['series']): MetricResult {
  return { warnings: [], series };
}
function fullSeries(
  labels: Record<string, string>,
  value: number,
  overrides: Record<number, number | null> = {}
) {
  const start = query.end - query.minutes * 60;
  const samples: [number, number | null][] = Array.from(
    { length: query.minutes * 4 + 1 },
    (_, index): [number, number | null] => {
      const timestamp = start + index * 15;
      return [
        timestamp,
        Object.prototype.hasOwnProperty.call(overrides, timestamp) ? overrides[timestamp] : value,
      ];
    }
  );
  return series(labels, samples);
}
function project(value: MetricResult) {
  return securityTelemetry(value, query);
}

it('uses destination-reported security telemetry for either workload direction', () => {
  const outbound = prometheusQueries(query).security;
  expect(outbound).toContain('request_protocol,connection_security_policy');
  expect(outbound).toContain(
    'reporter="destination",source_workload_namespace="bookinfo",source_cluster="east"'
  );
  expect(prometheusQueries({ ...query, direction: 'inbound' }).security).toContain(
    'reporter="destination",destination_workload_namespace="bookinfo"'
  );
});

it('projects returned encrypted, plaintext, mixed and unknown HTTP/gRPC evidence without dropping unknown labels', () => {
  const projection = project(
    result([
      fullSeries({ request_protocol: 'http', connection_security_policy: 'mutual_tls' }, 8),
      fullSeries({ request_protocol: 'http', connection_security_policy: 'none' }, 2),
      fullSeries({ request_protocol: 'http', connection_security_policy: 'external_policy' }, 1),
      fullSeries({ request_protocol: 'grpc', connection_security_policy: 'mutual_tls' }, 3),
      fullSeries({ request_protocol: 'grpc' }, 1),
    ])
  );
  expect(projection.protocols).toEqual([
    { protocol: 'grpc', category: 'encrypted', completeness: 'partial', timestamp: 10000 },
    { protocol: 'http', category: 'mixed', completeness: 'partial', timestamp: 10000 },
  ]);
  expect(projection.rates).toEqual([
    {
      protocol: 'grpc',
      policy: 'mutual_tls',
      rate: 3,
      observedPercent: 75,
      timestamp: 10000,
    },
    { protocol: 'grpc', policy: 'unknown', rate: 1, observedPercent: 25, timestamp: 10000 },
    {
      protocol: 'http',
      policy: 'external_policy',
      rate: 1,
      observedPercent: 100 / 11,
      timestamp: 10000,
    },
    {
      protocol: 'http',
      policy: 'mutual_tls',
      rate: 8,
      observedPercent: (8 / 11) * 100,
      timestamp: 10000,
    },
    {
      protocol: 'http',
      policy: 'none',
      rate: 2,
      observedPercent: (2 / 11) * 100,
      timestamp: 10000,
    },
  ]);
});

it('classifies observations across the selected range and keeps latest rates aligned', () => {
  const projection = project(
    result([
      fullSeries({ request_protocol: 'http', connection_security_policy: 'mutual_tls' }, 0, {
        9985: 3,
      }),
      fullSeries({ request_protocol: 'http', connection_security_policy: 'none' }, 0, {
        9985: 2,
      }),
    ])
  );
  expect(projection.protocols).toEqual([
    { protocol: 'http', category: 'mixed', completeness: 'available', timestamp: 10000 },
  ]);
  expect(projection.rates).toEqual([
    {
      protocol: 'http',
      policy: 'mutual_tls',
      rate: 0,
      observedPercent: null,
      timestamp: 10000,
    },
    {
      protocol: 'http',
      policy: 'none',
      rate: 0,
      observedPercent: null,
      timestamp: 10000,
    },
  ]);
});

it('marks none-only observations as plaintext-labeled, not as configured policy', () => {
  expect(
    project(
      result([fullSeries({ request_protocol: 'http', connection_security_policy: 'none' }, 1)])
    ).protocols
  ).toEqual([
    { protocol: 'http', category: 'plaintext', completeness: 'available', timestamp: 10000 },
  ]);
});

it('keeps unsupported protocols, unknown labels, zero rates and missing samples distinct', () => {
  const projection = project(
    result([
      series({ request_protocol: 'tcp', connection_security_policy: 'none' }, [[10000, 2]]),
      series({ request_protocol: 'http', connection_security_policy: 'custom_policy' }, [
        [10000, 1],
      ]),
      series({ request_protocol: 'grpc', connection_security_policy: 'mutual_tls' }, [[10000, 0]]),
      series({ request_protocol: 'http', connection_security_policy: 'none' }, [[10000, null]]),
      series({ connection_security_policy: 'none' }, [[10000, 2]]),
    ])
  );
  expect(projection.protocols).toEqual([
    { protocol: 'grpc', category: 'unavailable', completeness: 'unavailable', timestamp: 10000 },
    { protocol: 'http', category: 'unknown', completeness: 'partial', timestamp: 10000 },
    { protocol: 'tcp', category: 'unsupported', completeness: 'partial', timestamp: 10000 },
    { protocol: 'unknown', category: 'unsupported', completeness: 'partial', timestamp: 10000 },
  ]);
  expect(projection.rates.find(row => row.policy === 'custom_policy')?.policy).toBe(
    'custom_policy'
  );
  expect(projection.rates.find(row => row.protocol === 'grpc')?.observedPercent).toBeNull();
  expect(projection.rates.find(row => row.policy === 'none')?.rate).toBeNull();
  expect(project(result([]))).toEqual({ rates: [], protocols: [] });
  expect(
    project(
      result([
        series({ request_protocol: 'http', connection_security_policy: 'mutual_tls' }, [
          [10000, 0],
        ]),
      ])
    ).protocols[0]
  ).toMatchObject({ category: 'unavailable', completeness: 'unavailable' });
  const warned = project({
    warnings: ['partial response'],
    series: [fullSeries({ request_protocol: 'http', connection_security_policy: 'mutual_tls' }, 1)],
  });
  expect(warned.protocols[0]).toMatchObject({ category: 'encrypted', completeness: 'partial' });
  expect(warned.rates[0].observedPercent).toBeNull();
  const sparse = project(
    result([
      series({ request_protocol: 'http', connection_security_policy: 'mutual_tls' }, [[10000, 1]]),
    ])
  );
  expect(sparse.protocols[0]).toMatchObject({ category: 'encrypted', completeness: 'partial' });
  expect(sparse.rates[0].observedPercent).toBeNull();
  const stale = project({
    warnings: [],
    series: [
      series({ request_protocol: 'http', connection_security_policy: 'mutual_tls' }, [[9985, 1]]),
    ],
  });
  expect(stale.protocols[0]).toMatchObject({ category: 'encrypted', completeness: 'partial' });
  expect(stale.rates[0].observedPercent).toBeNull();
});

it.each([
  [
    series({ request_protocol: 'http' }, [[10000, 1]]),
    series({ request_protocol: 'http', connection_security_policy: '' }, [[10000, 2]]),
  ],
])('rejects duplicate aggregated security groups', (...series) => {
  expect(() => project(result(series))).toThrow('Duplicate');
});

it('rejects unsupported reporter dimensions, invalid rates and over-budget series', () => {
  expect(() =>
    project(
      result([
        series(
          {
            reporter: 'source',
            request_protocol: 'http',
            connection_security_policy: 'mutual_tls',
          },
          [[10000, 1]]
        ),
      ])
    )
  ).toThrow('undeclared grouping label');
  expect(() =>
    project(
      result([
        series({ request_protocol: 'http', connection_security_policy: 'none' }, [[10000, -1]]),
      ])
    )
  ).toThrow('Invalid security metric sample');
  expect(() =>
    project(
      result(
        Array.from({ length: 9 }, (_, index) =>
          series({ request_protocol: `protocol-${index}`, connection_security_policy: 'none' }, [
            [10000, 1],
          ])
        )
      )
    )
  ).toThrow('8-series');
});
