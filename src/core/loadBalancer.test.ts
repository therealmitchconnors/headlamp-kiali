import {
  cookieDuration,
  initialLoadBalancer,
  loadBalancerChange,
  LoadBalancerDraft,
  planLoadBalancer,
  SIMPLE_LOAD_BALANCERS,
} from './loadBalancer';

const original = {
  host: 'reviews',
  exportTo: ['.'],
  custom: false,
  subsets: [{ name: 'v1', trafficPolicy: { loadBalancer: { simple: 'RANDOM' } } }],
  trafficPolicy: {
    tls: { mode: 'ISTIO_MUTUAL' },
    connectionPool: { tcp: { maxConnections: 10 } },
    portLevelSettings: [{ port: { number: 80 }, loadBalancer: { simple: 'PASSTHROUGH' } }],
    loadBalancer: {
      consistentHash: {
        httpCookie: {
          name: 'session',
          path: '/shop',
          ttl: '30s',
          attributes: [{ name: 'SameSite', value: 'Lax' }],
        },
        ringHash: { minimumRingSize: 1024 },
      },
      localityLbSetting: { enabled: false },
      warmupDurationSecs: '10s',
      extension: { zero: 0 },
    },
  },
};
const draft = (changes: Partial<LoadBalancerDraft> = {}) => ({
  ...initialLoadBalancer(original),
  ...changes,
});
it('initializes without proposing changes and preserves declared legacy algorithms', () => {
  expect(initialLoadBalancer(original)).toMatchObject({
    mode: 'keep',
    strategy: 'cookie',
    cookieName: 'session',
    cookieTtl: '30s',
  });
  expect(
    initialLoadBalancer({ trafficPolicy: { loadBalancer: { simple: 'LEAST_CONN' } } }).simple
  ).toBe('LEAST_CONN');
  expect(loadBalancerChange(draft())).toBeUndefined();
  expect(() => planLoadBalancer(original, draft())).toThrow(/Choose/);
});
it('updates cookie affinity while preserving its path, attributes, hash algorithm and unrelated policy', () => {
  const before = JSON.stringify(original);
  const result = planLoadBalancer(
    original,
    draft({ mode: 'set', cookieName: 'new-session', cookieTtl: '0s' })
  );
  expect(result.spec).toEqual({
    ...original,
    trafficPolicy: {
      ...original.trafficPolicy,
      loadBalancer: {
        ...original.trafficPolicy.loadBalancer,
        consistentHash: {
          ...original.trafficPolicy.loadBalancer.consistentHash,
          httpCookie: {
            ...original.trafficPolicy.loadBalancer.consistentHash.httpCookie,
            name: 'new-session',
            ttl: '0s',
          },
        },
      },
    },
  });
  expect(JSON.stringify(original)).toBe(before);
});
it.each(SIMPLE_LOAD_BALANCERS)(
  'replaces affinity with %s without altering locality or warmup',
  simple => {
    const result = planLoadBalancer(original, draft({ mode: 'set', strategy: 'simple', simple }));
    expect(result.spec.trafficPolicy).toEqual({
      ...original.trafficPolicy,
      loadBalancer: {
        simple,
        localityLbSetting: { enabled: false },
        warmupDurationSecs: '10s',
        extension: { zero: 0 },
      },
    });
  }
);
it.each(['header', 'source-ip'] as const)(
  'clears incompatible affinity keys when switching to %s',
  strategy => {
    const result = planLoadBalancer(
      original,
      draft({ mode: 'set', strategy, header: 'x-user-id' })
    );
    expect(result.spec).toMatchObject({
      trafficPolicy: {
        loadBalancer: {
          consistentHash: {
            ringHash: { minimumRingSize: 1024 },
            ...(strategy === 'header' ? { httpHeaderName: 'x-user-id' } : { useSourceIp: true }),
          },
        },
      },
    });
    const serialized = JSON.stringify(result.spec);
    expect(serialized).not.toContain('httpCookie');
  }
);
it('removes all top-level balancer settings while preserving other policies and overrides', () => {
  const result = planLoadBalancer(original, draft({ mode: 'remove' }));
  expect(result.spec.trafficPolicy).toEqual({
    tls: original.trafficPolicy.tls,
    connectionPool: original.trafficPolicy.connectionPool,
    portLevelSettings: original.trafficPolicy.portLevelSettings,
  });
  expect(result.spec.subsets).toEqual(original.subsets);
  expect(
    planLoadBalancer(
      { host: 'reviews', trafficPolicy: { loadBalancer: { simple: 'RANDOM' } } },
      draft({ mode: 'remove' })
    ).spec
  ).toEqual({ host: 'reviews' });
});
it('rejects no-op edits even when hash keys precede algorithm keys', () => {
  expect(() => planLoadBalancer(original, draft({ mode: 'set' }))).toThrow(/would not change/);
  expect(() =>
    planLoadBalancer({ host: 'reviews', trafficPolicy: null }, draft({ mode: 'remove' }))
  ).toThrow(/would not change/);
});
it('validates HTTP tokens, pseudo headers and exact length boundaries', () => {
  expect(
    loadBalancerChange(draft({ mode: 'set', strategy: 'header', header: ':authority' }))
  ).toEqual({ consistentHash: { httpHeaderName: ':authority' } });
  expect(
    loadBalancerChange(draft({ mode: 'set', strategy: 'header', header: 'x'.repeat(256) }))
  ).toBeDefined();
  for (const header of ['', ' ', 'x\r\nbad', 'x'.repeat(257), 'x?value'])
    expect(() => loadBalancerChange(draft({ mode: 'set', strategy: 'header', header }))).toThrow(
      /HTTP token/
    );
  for (const cookieName of ['', ':cookie', 'a;b', 'cookie/name'])
    expect(() =>
      loadBalancerChange(draft({ mode: 'set', strategy: 'cookie', cookieName }))
    ).toThrow(/HTTP token/);
});
it('preserves canonical duration precision and rejects malformed or out-of-range TTLs', () => {
  for (const value of ['0s', '30s', '0.000000001s', '315576000000s'])
    expect(cookieDuration(value)).toBe(value);
  for (const value of [
    '',
    '1',
    '1h',
    '-1s',
    '1.s',
    '1s\n',
    '0.0000000001s',
    '315576000001s',
    '999999999999999999999999s',
  ])
    expect(() => cookieDuration(value)).toThrow(/protobuf seconds/);
});
it('rejects unknown actions/strategies and malformed edited objects', () => {
  expect(() => loadBalancerChange({ ...draft(), mode: 'invalid' } as never)).toThrow(/Unknown/);
  expect(() =>
    loadBalancerChange({ ...draft(), mode: 'set', strategy: 'invalid' } as never)
  ).toThrow(/Unknown/);
  expect(() =>
    loadBalancerChange({ ...draft(), mode: 'set', strategy: 'simple', simple: 'invalid' } as never)
  ).toThrow(/Unknown/);
  expect(() =>
    planLoadBalancer(
      { host: 'reviews', trafficPolicy: { loadBalancer: false } },
      draft({ mode: 'set' })
    )
  ).toThrow(/specification editor/);
});
