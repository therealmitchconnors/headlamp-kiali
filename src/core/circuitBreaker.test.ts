import {
  circuitBreakerChanges,
  CircuitBreakerDraft,
  initialCircuitBreaker,
  planCircuitBreaker,
} from './circuitBreaker';

const original = {
  host: 'reviews.bookinfo.svc.cluster.local',
  exportTo: ['.'],
  custom: { enabled: false, count: 0 },
  subsets: [
    {
      name: 'v1',
      labels: { version: 'v1' },
      trafficPolicy: { connectionPool: { tcp: { maxConnections: 2 } } },
    },
  ],
  trafficPolicy: {
    tls: { mode: 'ISTIO_MUTUAL' },
    loadBalancer: { simple: 'LEAST_REQUEST' },
    portLevelSettings: [{ port: { number: 9080 }, connectionPool: { tcp: { maxConnections: 3 } } }],
    connectionPool: {
      tcp: { maxConnections: 4, connectTimeout: '7s', tcpKeepalive: { probes: 2 } },
      http: { http1MaxPendingRequests: 5, http2MaxRequests: 20, useClientProtocol: false },
      extension: { enabled: false },
    },
    outlierDetection: {
      consecutiveErrors: 6,
      interval: '10s',
      maxEjectionPercent: 50,
      splitExternalLocalOriginErrors: false,
    },
  },
};
const draft = (changes: Partial<CircuitBreakerDraft> = {}) => ({
  ...initialCircuitBreaker(original),
  ...changes,
});
it('retains explicit zero and reads the canonical threshold before the legacy alias', () => {
  expect(initialCircuitBreaker(original)).toMatchObject({
    connectionPoolMode: 'keep',
    maxConnections: '4',
    http1MaxPendingRequests: '5',
    outlierMode: 'keep',
    consecutive5xxErrors: '6',
  });
  expect(
    initialCircuitBreaker({
      trafficPolicy: {
        connectionPool: { tcp: { maxConnections: 0 } },
        outlierDetection: { consecutive5xxErrors: 0, consecutiveErrors: 9 },
      },
    })
  ).toMatchObject({ maxConnections: '0', consecutive5xxErrors: '0' });
  expect(initialCircuitBreaker()).toMatchObject({
    maxConnections: '1',
    http1MaxPendingRequests: '1',
    consecutive5xxErrors: '1',
  });
});
it('sets only the owned top-level fields, migrates the threshold and does not mutate the source', () => {
  const before = JSON.stringify(original);
  const result = planCircuitBreaker(
    original,
    draft({
      connectionPoolMode: 'set',
      maxConnections: '10',
      http1MaxPendingRequests: '0',
      outlierMode: 'set',
      consecutive5xxErrors: '0',
    })
  );
  expect(result.spec).toEqual({
    ...original,
    trafficPolicy: {
      ...original.trafficPolicy,
      connectionPool: {
        ...original.trafficPolicy.connectionPool,
        tcp: { ...original.trafficPolicy.connectionPool.tcp, maxConnections: 10 },
        http: { ...original.trafficPolicy.connectionPool.http, http1MaxPendingRequests: 0 },
      },
      outlierDetection: {
        consecutive5xxErrors: 0,
        interval: '10s',
        maxEjectionPercent: 50,
        splitExternalLocalOriginErrors: false,
      },
    },
  });
  expect(JSON.stringify(original)).toBe(before);
});
it('keeps the other group unchanged and removes only explicitly selected groups', () => {
  const removed = planCircuitBreaker(original, draft({ connectionPoolMode: 'remove' }));
  expect(removed.spec.trafficPolicy).toEqual({
    tls: original.trafficPolicy.tls,
    loadBalancer: original.trafficPolicy.loadBalancer,
    portLevelSettings: original.trafficPolicy.portLevelSettings,
    outlierDetection: original.trafficPolicy.outlierDetection,
  });
  const empty = planCircuitBreaker(
    {
      host: 'reviews',
      trafficPolicy: {
        connectionPool: { tcp: { maxConnections: 1 } },
        outlierDetection: { consecutive5xxErrors: 1 },
      },
    },
    draft({ connectionPoolMode: 'remove', outlierMode: 'remove' })
  );
  expect(empty.spec).toEqual({ host: 'reviews' });
});
it('rejects no-op edits, including removing an absent group without changing null wrappers', () => {
  expect(() => planCircuitBreaker(original, draft())).toThrow(/Choose/);
  expect(() => planCircuitBreaker(original, draft({ connectionPoolMode: 'set' }))).toThrow(
    /would not change/
  );
  expect(() =>
    planCircuitBreaker({ host: 'reviews', trafficPolicy: null }, draft({ outlierMode: 'remove' }))
  ).toThrow(/would not change/);
  expect(circuitBreakerChanges(initialCircuitBreaker())).toEqual({});
});
it('enforces exact signed and unsigned protobuf integer boundaries', () => {
  expect(
    circuitBreakerChanges(
      draft({
        connectionPoolMode: 'set',
        maxConnections: '2147483647',
        http1MaxPendingRequests: '0',
        outlierMode: 'set',
        consecutive5xxErrors: '4294967295',
      })
    )
  ).toEqual({
    connectionPool: { tcp: { maxConnections: 2147483647 }, http: { http1MaxPendingRequests: 0 } },
    outlierDetection: { consecutive5xxErrors: 4294967295 },
  });
  for (const [field, mode] of [
    ['maxConnections', 'connectionPoolMode'],
    ['http1MaxPendingRequests', 'connectionPoolMode'],
    ['consecutive5xxErrors', 'outlierMode'],
  ] as const)
    for (const value of ['', '-1', '1.5', 'Infinity', 'NaN', '0x10', '1e3', '99999999999'])
      expect(() => circuitBreakerChanges(draft({ [mode]: 'set', [field]: value }))).toThrow(
        /whole number/
      );
  expect(() =>
    circuitBreakerChanges(draft({ connectionPoolMode: 'set', maxConnections: '2147483648' }))
  ).toThrow();
  expect(() =>
    circuitBreakerChanges(draft({ outlierMode: 'set', consecutive5xxErrors: '4294967296' }))
  ).toThrow();
});
it('rejects malformed edited groups and unknown actions without dropping unowned fields', () => {
  for (const trafficPolicy of [
    false,
    { connectionPool: false },
    { connectionPool: { tcp: [] } },
    { connectionPool: { http: 'bad' } },
  ])
    expect(() =>
      planCircuitBreaker({ host: 'reviews', trafficPolicy }, draft({ connectionPoolMode: 'set' }))
    ).toThrow(/specification editor/);
  expect(() =>
    planCircuitBreaker(
      { host: 'reviews', trafficPolicy: { outlierDetection: false } },
      draft({ outlierMode: 'set' })
    )
  ).toThrow(/specification editor/);
  expect(() => circuitBreakerChanges({ ...draft(), outlierMode: 'unsupported' } as never)).toThrow(
    /Unknown/
  );
  expect(() => planCircuitBreaker({}, draft({ outlierMode: 'set' }))).toThrow(
    /DestinationRule host/
  );
});
