import { CORRELATION_SOURCES, decodeCorrelationResource } from '../data/correlation';
import { initialCircuitBreaker } from './circuitBreaker';
import { correlateResources } from './correlation';
import { initialHttpBehavior } from './httpRouteBehavior';
import { initialLoadBalancer } from './loadBalancer';
import { initialOutboundTls } from './outboundTls';
import { namespaceScope } from './scope';
import type { ServiceTrafficDraft } from './serviceTraffic';
import { routingService, serviceTrafficPlan, serviceTrafficVersions } from './serviceTraffic';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
const serviceObject = {
  apiVersion: 'v1',
  kind: 'Service',
  metadata: { name: 'reviews', namespace: 'bookinfo', uid: 'svc', resourceVersion: '1' },
  spec: { selector: { app: 'reviews' }, ports: [{ name: 'http', port: 9080 }] },
};
const service = routingService(serviceObject, 'alpha', 'bookinfo', 'reviews');
function relation(values = ['v1', 'v2', 'v3']) {
  const scope = namespaceScope('alpha', 'bookinfo');
  const source = (kind: string) => CORRELATION_SOURCES.find(source => source.kind === kind)!;
  return correlateResources([
    decodeCorrelationResource(serviceObject, source('Service'), scope),
    ...values.map((version, index) =>
      decodeCorrelationResource(
        {
          metadata: { name: `reviews-${index}`, namespace: 'bookinfo', uid: `d${index}` },
          spec: { template: { metadata: { labels: { app: 'reviews', version } } } },
        },
        source('Deployment'),
        scope
      )
    ),
  ]).serviceRelations[0];
}
it('groups identical version selectors and follows the pinned remainder-on-last weight default', () => {
  const source = serviceTrafficVersions(relation());
  expect(source.label).toBe('version');
  expect(source.versions.map(version => version.weight)).toEqual([33, 33, 34]);
  const grouped = serviceTrafficVersions(relation(['v1', 'v1', 'v2']));
  expect(grouped.versions).toHaveLength(2);
  expect(grouped.versions[0].workloads).toHaveLength(2);
  expect(grouped.versions.map(version => version.weight)).toEqual([66, 34]);
});
it('generates only namespace-local subsets and port-scoped HTTP destinations without altering evidence', () => {
  const source = serviceTrafficVersions(relation());
  const before = JSON.stringify([service, source]);
  const plan = serviceTrafficPlan(service, 'svc.cluster.local', source.label, source.versions, {
    destinationRuleName: 'reviews-routing',
    virtualServiceName: 'reviews-routing',
    port: 9080,
    subsets: source.versions.map(version => ({
      name: version.subset,
      version: version.value,
      weight: version.weight,
    })),
  });
  expect(plan.destinationRule).toEqual({
    host: 'reviews.bookinfo.svc.cluster.local',
    exportTo: ['.'],
    subsets: ['v1', 'v2', 'v3'].map(name => ({ name, labels: { version: name } })),
  });
  expect(plan.virtualService).toEqual({
    hosts: ['reviews.bookinfo.svc.cluster.local'],
    gateways: ['mesh'],
    exportTo: ['.'],
    http: [
      {
        match: [{ port: 9080 }],
        route: source.versions.map(version => ({
          destination: { host: plan.host, subset: version.subset, port: { number: 9080 } },
          weight: version.weight,
        })),
      },
    ],
  });
  expect(JSON.stringify([service, source])).toBe(before);
});
it('requires explicit safe labels, subsets, ports and complete observed versions', () => {
  const source = serviceTrafficVersions(relation(['v1']));
  const draft = {
    destinationRuleName: 'routing',
    virtualServiceName: 'routing',
    port: 9080,
    subsets: [{ name: 'v1', version: 'v1', weight: 100 }],
  };
  for (const changes of [
    { port: 9090 },
    { destinationRuleName: '../bad' },
    { subsets: [{ name: 'v1', version: 'unobserved', weight: 100 }] },
    { subsets: [{ name: 'bad.name', version: 'v1', weight: 100 }] },
    { subsets: [{ name: 'v1', version: 'v1', weight: 99 }] },
  ])
    expect(() =>
      serviceTrafficPlan(service, 'svc.cluster.local', source.label, source.versions, {
        ...draft,
        ...changes,
      })
    ).toThrow();
  expect(() => serviceTrafficVersions(relation(), 'missing')).toThrow('does not have');
  expect(() =>
    serviceTrafficVersions(relation(Array.from({ length: 21 }, (_, i) => `v${i}`)))
  ).toThrow('20 distinct');
  const empty = serviceTrafficVersions(relation(['']));
  expect(empty.versions[0].subset).toBe('');
  expect(empty.versions[0].value).toBe('');
});
it('rejects selectorless, replaced, external-name or non-TCP Service evidence', () => {
  for (const object of [
    { ...serviceObject, metadata: { ...serviceObject.metadata, uid: '' } },
    { ...serviceObject, spec: { ...serviceObject.spec, selector: {} } },
    { ...serviceObject, spec: { ...serviceObject.spec, type: 'ExternalName' } },
    { ...serviceObject, spec: { ...serviceObject.spec, ports: [{ port: 53, protocol: 'UDP' }] } },
  ])
    expect(() => routingService(object, 'alpha', 'bookinfo', 'reviews')).toThrow();
});

it('adds explicitly requested circuit settings only to the generated DestinationRule', () => {
  const source = serviceTrafficVersions(relation(['v1']));
  const plan = serviceTrafficPlan(service, 'svc.cluster.local', source.label, source.versions, {
    destinationRuleName: 'reviews',
    virtualServiceName: 'reviews',
    port: 9080,
    subsets: [{ name: 'v1', version: 'v1', weight: 100 }],
    circuitBreaker: {
      ...initialCircuitBreaker(),
      connectionPoolMode: 'set',
      maxConnections: '100',
      http1MaxPendingRequests: '20',
      outlierMode: 'set',
      consecutive5xxErrors: '0',
    },
  });
  expect(plan.destinationRule.trafficPolicy).toEqual({
    connectionPool: { tcp: { maxConnections: 100 }, http: { http1MaxPendingRequests: 20 } },
    outlierDetection: { consecutive5xxErrors: 0 },
  });
  expect(plan.destinationRule.trafficPolicy).not.toHaveProperty('tls');
  expect(plan.virtualService).not.toHaveProperty('trafficPolicy');
  expect(plan.destinationRule.subsets).toEqual([{ name: 'v1', labels: { version: 'v1' } }]);
});

it('combines explicit affinity and circuit settings without touching routing or TLS', () => {
  const source = serviceTrafficVersions(relation(['v1']));
  const plan = serviceTrafficPlan(service, 'svc.cluster.local', source.label, source.versions, {
    destinationRuleName: 'reviews',
    virtualServiceName: 'reviews',
    port: 9080,
    subsets: [{ name: 'v1', version: 'v1', weight: 100 }],
    circuitBreaker: { ...initialCircuitBreaker(), outlierMode: 'set', consecutive5xxErrors: '0' },
    loadBalancer: {
      ...initialLoadBalancer(),
      mode: 'set',
      strategy: 'cookie',
      cookieName: 'session',
      cookieTtl: '0s',
    },
  });
  expect(plan.destinationRule.trafficPolicy).toEqual({
    outlierDetection: { consecutive5xxErrors: 0 },
    loadBalancer: { consistentHash: { httpCookie: { name: 'session', ttl: '0s' } } },
  });
  expect(plan.virtualService).not.toHaveProperty('trafficPolicy');
});

it('only adds explicitly selected outbound TLS and composes it with the other optional settings', () => {
  const source = serviceTrafficVersions(relation(['v1', 'v2']));
  const draft: ServiceTrafficDraft = {
    destinationRuleName: 'reviews',
    virtualServiceName: 'reviews',
    port: 9080,
    subsets: [
      { name: 'v1', version: 'v1', weight: 100 },
      { name: 'v2', version: 'v2', weight: 0 },
    ],
    mirror: { version: 'v2', percentage: '10' },
    circuitBreaker: { ...initialCircuitBreaker(), outlierMode: 'set', consecutive5xxErrors: '3' },
    loadBalancer: { ...initialLoadBalancer(), mode: 'set', strategy: 'simple', simple: 'RANDOM' },
    outboundTls: initialOutboundTls(),
  };
  const original = serviceTrafficPlan(
    service,
    'svc.cluster.local',
    source.label,
    source.versions,
    draft
  );
  expect(original.destinationRule.trafficPolicy).not.toHaveProperty('tls');
  const plan = serviceTrafficPlan(service, 'svc.cluster.local', source.label, source.versions, {
    ...draft,
    outboundTls: { ...initialOutboundTls(), action: 'set', mode: 'ISTIO_MUTUAL' },
  });
  expect(plan.destinationRule.trafficPolicy).toEqual({
    outlierDetection: { consecutive5xxErrors: 3 },
    loadBalancer: { simple: 'RANDOM' },
    tls: { mode: 'ISTIO_MUTUAL' },
  });
  expect(plan.virtualService).toEqual(original.virtualService);
});

it('creates explicit port-scoped TCP routes without HTTP fields and keeps shared policies', () => {
  const source = serviceTrafficVersions(relation(['v1', 'v2']));
  const draft: ServiceTrafficDraft = {
    protocol: 'tcp',
    destinationRuleName: 'reviews',
    virtualServiceName: 'reviews',
    port: 9080,
    subsets: [
      { name: 'v1', version: 'v1', weight: 80 },
      { name: 'v2', version: 'v2', weight: 20 },
    ],
    loadBalancer: { ...initialLoadBalancer(), mode: 'set', strategy: 'source-ip' },
    outboundTls: { ...initialOutboundTls(), action: 'set', mode: 'ISTIO_MUTUAL' },
  };
  const plan = serviceTrafficPlan(
    service,
    'svc.cluster.local',
    source.label,
    source.versions,
    draft
  );
  expect(plan.virtualService).toEqual({
    hosts: [plan.host],
    gateways: ['mesh'],
    exportTo: ['.'],
    tcp: [
      {
        match: [{ port: 9080 }],
        route: draft.subsets.map(subset => ({
          destination: { host: plan.host, subset: subset.name, port: { number: 9080 } },
          weight: subset.weight,
        })),
      },
    ],
  });
  expect(plan.destinationRule.trafficPolicy).toEqual({
    loadBalancer: { consistentHash: { useSourceIp: true } },
    tls: { mode: 'ISTIO_MUTUAL' },
  });
  expect(() =>
    serviceTrafficPlan(service, 'svc.cluster.local', source.label, source.versions, {
      ...draft,
      mirror: { version: 'v2', percentage: '50' },
    })
  ).toThrow('Remove the mirrored version');
  for (const strategy of ['header', 'cookie'] as const) {
    expect(() =>
      serviceTrafficPlan(service, 'svc.cluster.local', source.label, source.versions, {
        ...draft,
        loadBalancer: {
          ...initialLoadBalancer(),
          mode: 'set',
          strategy,
          header: 'x-user',
          cookieName: 'session',
        },
      })
    ).toThrow('HTTP header or cookie affinity');
  }
  const invalid = structuredClone(draft);
  for (const protocol of ['udp', null]) {
    Object.assign(invalid, { protocol });
    expect(() =>
      serviceTrafficPlan(service, 'svc.cluster.local', source.label, source.versions, invalid)
    ).toThrow('HTTP/gRPC or TCP');
  }
  expect(() =>
    serviceTrafficPlan(service, 'svc.cluster.local', source.label, source.versions, {
      ...draft,
      subsets: [{ name: 'v1', version: 'v1', weight: 99 }],
    })
  ).toThrow('sum to 100');
});

it('composes HTTP timing or fault creation with mirrors and preserves independent DestinationRule settings', () => {
  const source = serviceTrafficVersions(relation(['v1', 'v2']));
  const draft: ServiceTrafficDraft = {
    protocol: 'http',
    destinationRuleName: 'reviews',
    virtualServiceName: 'reviews',
    port: 9080,
    subsets: [
      { name: 'v1', version: 'v1', weight: 100 },
      { name: 'v2', version: 'v2', weight: 0 },
    ],
    mirror: { version: 'v2', percentage: '5' },
    outboundTls: { ...initialOutboundTls(), action: 'set', mode: 'ISTIO_MUTUAL' },
    httpBehavior: initialHttpBehavior({ index: 0, value: {} }),
  };
  const baseline = serviceTrafficPlan(
    service,
    'svc.cluster.local',
    source.label,
    source.versions,
    draft
  );
  const expectedRoute = {
    match: [{ port: 9080 }],
    route: [
      { destination: { host: baseline.host, subset: 'v1', port: { number: 9080 } }, weight: 100 },
    ],
    mirror: { host: baseline.host, subset: 'v2', port: { number: 9080 } },
    mirrorPercentage: { value: 5 },
  };
  expect(baseline.virtualService).toHaveProperty('http', [expectedRoute]);
  const timing = serviceTrafficPlan(service, 'svc.cluster.local', source.label, source.versions, {
    ...draft,
    httpBehavior: {
      ...initialHttpBehavior({ index: 0, value: {} }),
      timeoutMode: 'set',
      timeout: '10s',
      retryMode: 'set',
      attempts: '2',
      perTryTimeout: '2s',
    },
  });
  expect(timing.destinationRule).toEqual(baseline.destinationRule);
  expect(timing.virtualService).toHaveProperty('http', [
    {
      ...expectedRoute,
      timeout: '10s',
      retries: {
        attempts: 2,
        perTryTimeout: '2s',
        retryOn: 'gateway-error,connect-failure,refused-stream',
      },
    },
  ]);
  const fault = {
    ...initialHttpBehavior({ index: 0, value: {} }),
    delayMode: 'set' as const,
    abortMode: 'set' as const,
  };
  const faults = serviceTrafficPlan(service, 'svc.cluster.local', source.label, source.versions, {
    ...draft,
    httpBehavior: fault,
  });
  expect(faults.destinationRule).toEqual(baseline.destinationRule);
  expect(faults.virtualService).toHaveProperty('http', [
    {
      ...expectedRoute,
      fault: {
        delay: { fixedDelay: '5s', percentage: { value: 10 } },
        abort: { httpStatus: 503, percentage: { value: 10 } },
      },
    },
  ]);
  expect(() =>
    serviceTrafficPlan(service, 'svc.cluster.local', source.label, source.versions, {
      ...draft,
      httpBehavior: { ...fault, timeoutMode: 'set' },
    })
  ).toThrow('cannot be combined');
  expect(() =>
    serviceTrafficPlan(service, 'svc.cluster.local', source.label, source.versions, {
      ...draft,
      protocol: 'tcp',
      mirror: undefined,
      httpBehavior: fault,
    })
  ).toThrow('Exclude HTTP timeout');
});

it('constrains every HTTP match alternative to the selected port and preserves routing/policies', () => {
  const source = serviceTrafficVersions(relation(['v1', 'v2']));
  const draft: ServiceTrafficDraft = {
    protocol: 'http',
    destinationRuleName: 'reviews',
    virtualServiceName: 'reviews',
    port: 9080,
    subsets: [
      { name: 'v1', version: 'v1', weight: 100 },
      { name: 'v2', version: 'v2', weight: 0 },
    ],
    mirror: { version: 'v2', percentage: '5' },
    outboundTls: { ...initialOutboundTls(), action: 'set', mode: 'ISTIO_MUTUAL' },
    httpMatches: [
      { field: 'headers', header: 'x-user', operator: 'exact', value: 'tester' },
      { field: 'headers', header: 'x-enabled', operator: 'presence', value: '' },
      { field: 'uri', header: '', operator: 'prefix', value: '/reviews' },
    ],
  };
  const plan = serviceTrafficPlan(
    service,
    'svc.cluster.local',
    source.label,
    source.versions,
    draft
  );
  expect(plan.virtualService).toMatchObject({
    http: [
      {
        match: [
          { headers: { 'x-user': { exact: 'tester' }, 'x-enabled': {} }, port: 9080 },
          { uri: { prefix: '/reviews' }, port: 9080 },
        ],
        route: [{ weight: 100, destination: { subset: 'v1', port: { number: 9080 } } }],
        mirror: { subset: 'v2' },
        mirrorPercentage: { value: 5 },
      },
    ],
  });
  expect(plan.destinationRule.trafficPolicy?.tls).toEqual({ mode: 'ISTIO_MUTUAL' });
  expect(() =>
    serviceTrafficPlan(service, 'svc.cluster.local', source.label, source.versions, {
      ...draft,
      protocol: 'tcp',
      mirror: undefined,
    })
  ).toThrow('Remove HTTP request conditions');
});

it('keeps the shadow subset but excludes it from forwarding and from the weight sum', () => {
  const source = serviceTrafficVersions(relation());
  const draft: ServiceTrafficDraft = {
    destinationRuleName: 'reviews',
    virtualServiceName: 'reviews',
    port: 9080,
    subsets: source.versions.map(version => ({
      name: version.subset,
      version: version.value,
      weight: version.value === 'v3' ? 77 : 50,
    })),
    mirror: { version: 'v3', percentage: '0.25' },
    loadBalancer: { ...initialLoadBalancer(), mode: 'set', strategy: 'simple', simple: 'RANDOM' },
  };
  const before = JSON.stringify(draft);
  const plan = serviceTrafficPlan(
    service,
    'svc.cluster.local',
    source.label,
    source.versions,
    draft
  );
  expect(plan.destinationRule.subsets).toHaveLength(3);
  expect(plan.virtualService).toMatchObject({
    http: [
      {
        match: [{ port: 9080 }],
        route: ['v1', 'v2'].map(subset => ({
          destination: { host: plan.host, subset, port: { number: 9080 } },
          weight: 50,
        })),
        mirror: { host: plan.host, subset: 'v3', port: { number: 9080 } },
        mirrorPercentage: { value: 0.25 },
      },
    ],
  });
  expect(plan.destinationRule.trafficPolicy?.loadBalancer).toEqual({ simple: 'RANDOM' });
  expect(JSON.stringify(draft)).toBe(before);
  for (const mirror of [
    { version: 'unobserved', percentage: '50' },
    { version: 'v3', percentage: '101' },
    { version: 'v1', percentage: '50' },
  ]) {
    expect(() =>
      serviceTrafficPlan(service, 'svc.cluster.local', source.label, source.versions, {
        ...draft,
        mirror,
      })
    ).toThrow();
  }
  expect(() =>
    serviceTrafficPlan(service, 'svc.cluster.local', source.label, source.versions, {
      ...draft,
      subsets: [draft.subsets[2]],
    })
  ).toThrow('one other forwarding');
});

it('allows an observed empty-label version as the shadow without using an empty-string sentinel', () => {
  const source = serviceTrafficVersions(relation(['', 'v1']));
  const plan = serviceTrafficPlan(service, 'svc.cluster.local', source.label, source.versions, {
    destinationRuleName: 'reviews',
    virtualServiceName: 'reviews',
    port: 9080,
    subsets: [
      { name: 'empty', version: '', weight: 0 },
      { name: 'v1', version: 'v1', weight: 100 },
    ],
    mirror: { version: '', percentage: '0' },
  });
  expect(plan.virtualService).toMatchObject({
    http: [
      { mirror: { subset: 'empty' }, mirrorPercentage: { value: 0 }, route: [{ weight: 100 }] },
    ],
  });
});
