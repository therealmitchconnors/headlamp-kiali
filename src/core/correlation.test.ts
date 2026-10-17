import {
  correlateResources,
  CorrelationKind,
  CorrelationResource,
  OwnerReference,
  resolveServiceHost,
} from './correlation';
import { Labels } from './labels';

function resource(
  kind: CorrelationKind,
  name: string,
  labels: Labels = {},
  overrides: Partial<CorrelationResource> = {}
): CorrelationResource {
  return {
    identity: {
      cluster: 'alpha',
      namespace: 'bookinfo',
      kind,
      name,
      uid: `${kind}:${name}`,
      group: ['Pod', 'Service', 'ReplicationController'].includes(kind)
        ? ''
        : ['Job', 'CronJob'].includes(kind)
        ? 'batch'
        : 'apps',
    },
    labels,
    workloadLabels: labels,
    owners: [],
    serviceSelector: null,
    proxyMode: 'none',
    ...overrides,
  };
}

function owner(parent: CorrelationResource, controller = true): OwnerReference {
  return { ...parent.identity, controller };
}

function bookinfo(): CorrelationResource[] {
  const resources: CorrelationResource[] = [];
  for (const [app, versions] of [
    ['details', ['v1']],
    ['productpage', ['v1']],
    ['ratings', ['v1']],
    ['reviews', ['v1', 'v2', 'v3']],
  ] as const) {
    resources.push(resource('Service', app, { app }, { serviceSelector: { app } }));
    for (const version of versions) {
      const labels = { app, version };
      const deployment = resource('Deployment', `${app}-${version}`, labels);
      const replicaSet = resource('ReplicaSet', `${app}-${version}-rs`, labels, {
        owners: [owner(deployment)],
      });
      const pod = resource('Pod', `${app}-${version}-pod`, labels, {
        owners: [owner(replicaSet)],
        proxyMode: 'native-sidecar',
      });
      resources.push(deployment, replicaSet, pod);
    }
  }
  return resources;
}

describe('reusable application/workload/service correlation', () => {
  it('groups Bookinfo into four apps, without double-counting ReplicaSets or Services', () => {
    const result = correlateResources(bookinfo());
    expect(result.applications.map(app => app.name)).toEqual([
      'details',
      'productpage',
      'ratings',
      'reviews',
    ]);
    expect(result.workloads).toHaveLength(6);
    const reviews = result.applications.find(app => app.name === 'reviews')!;
    expect(reviews.versions).toEqual(['v1', 'v2', 'v3']);
    expect(reviews.workloads).toHaveLength(3);
    expect(reviews.services.map(service => service.identity.name)).toEqual(['reviews']);
    expect(reviews.pods).toHaveLength(3);
    expect(reviews.pods.every(pod => pod.proxyMode === 'native-sidecar')).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.unassignedPods).toEqual([]);
  });

  it('is deterministic and does not mutate input order or objects', () => {
    const resources = bookinfo();
    const before = JSON.stringify(resources);
    expect(correlateResources([...resources].reverse())).toEqual(correlateResources(resources));
    expect(JSON.stringify(resources)).toBe(before);
  });

  it('keeps identical names and UIDs in other scopes separate', () => {
    const originals = bookinfo();
    const otherCluster = originals.map(item => ({
      ...item,
      identity: { ...item.identity, cluster: 'beta' },
    }));
    const otherNamespace = originals.map(item => ({
      ...item,
      identity: { ...item.identity, namespace: 'other' },
    }));
    const result = correlateResources([...originals, ...otherCluster, ...otherNamespace]);
    expect(result.applications).toHaveLength(12);
    expect(
      result.applications.every(app =>
        app.pods.every(
          pod => pod.identity.cluster === app.cluster && pod.identity.namespace === app.namespace
        )
      )
    ).toBe(true);
  });

  it('does not bind a stale owner reference to a recreated same-name controller', () => {
    const deployment = resource('Deployment', 'reviews', { app: 'reviews' });
    const replicaSet = resource(
      'ReplicaSet',
      'reviews-rs',
      { app: 'reviews' },
      {
        owners: [{ ...owner(deployment), uid: 'deleted-deployment' }],
      }
    );
    const pod = resource('Pod', 'reviews-pod', { app: 'reviews' }, { owners: [owner(replicaSet)] });
    const result = correlateResources([deployment, replicaSet, pod]);
    expect(result.issues[0].reason).toBe('unresolved-owner');
    expect(
      result.workloads.find(workload => workload.identity.kind === 'Deployment')?.pods
    ).toEqual([]);
    expect(
      result.workloads.find(workload => workload.identity.kind === 'ReplicaSet')?.pods
    ).toEqual([pod]);
  });

  it('does not invent ownership from labels or non-controller references', () => {
    const deployment = resource('Deployment', 'reviews', { app: 'reviews' });
    const pod = resource(
      'Pod',
      'independent',
      { app: 'reviews' },
      { owners: [owner(deployment, false)] }
    );
    const result = correlateResources([deployment, pod]);
    expect(result.workloads).toHaveLength(2);
    expect(
      result.workloads.find(workload => workload.identity.kind === 'Deployment')?.pods
    ).toEqual([]);
  });

  it('leaves pods with unavailable parents unassigned', () => {
    const pod = resource(
      'Pod',
      'pending-owner',
      { app: 'reviews' },
      {
        owners: [
          { group: 'apps', kind: 'ReplicaSet', name: 'missing', uid: 'missing', controller: true },
        ],
      }
    );
    const result = correlateResources([pod]);
    expect(result.applications).toEqual([]);
    expect(result.unassignedPods).toEqual([pod]);
    expect(result.issues[0].reason).toBe('unresolved-owner');
  });

  it('detects owner cycles and mismatched identity instead of recursing or guessing', () => {
    const a = resource('ReplicaSet', 'a', { app: 'a' });
    const b = resource('ReplicaSet', 'b', { app: 'b' });
    a.owners = [owner(b)];
    b.owners = [owner(a)];
    const cycle = correlateResources([a, b]);
    expect(cycle.workloads).toEqual([]);
    expect(cycle.issues[0].reason).toBe('owner-cycle');
    const pod = resource('Pod', 'bad', { app: 'a' }, { owners: [{ ...owner(a), name: 'wrong' }] });
    expect(
      correlateResources([resource('ReplicaSet', 'a', { app: 'a' }), pod]).issues[0].reason
    ).toBe('owner-mismatch');
  });

  it('does not treat a selectorless Service as selecting every workload or pod', () => {
    const deployment = resource('Deployment', 'reviews', { app: 'reviews' });
    const service = resource(
      'Service',
      'manual-endpoints',
      { app: 'reviews' },
      { serviceSelector: {} }
    );
    const result = correlateResources([deployment, service]);
    expect(result.applications[0].services).toEqual([]);
    expect(result.serviceRelations[0].pods).toEqual([]);
  });

  it('preserves empty preferred labels and custom label semantics', () => {
    const workload = resource('Deployment', 'x', {
      'service.istio.io/canonical-name': '',
      app: 'fallback',
      'team/app': 'custom',
      'team/version': 'v2',
    });
    expect(correlateResources([workload]).applications[0].name).toBe('');
    expect(
      correlateResources([workload], { app: 'team/app', version: 'team/version' }).applications[0]
        .name
    ).toBe('custom');
  });

  it('excludes waypoint infrastructure and pod-identified ztunnels', () => {
    const waypoint = resource('Deployment', 'waypoint', {
      app: 'waypoint',
      'gateway.istio.io/managed': 'istio.io-mesh-controller',
    });
    const ztunnel = resource('DaemonSet', 'ztunnel', { app: 'ztunnel' });
    const pod = resource('Pod', 'ztunnel-pod', { app: 'ztunnel' }, { owners: [owner(ztunnel)] });
    const result = correlateResources([waypoint, ztunnel, pod]);
    expect(result.applications).toEqual([]);
    expect(result.infrastructure).toHaveLength(2);
  });

  it('rejects ambiguous duplicate snapshots', () => {
    const item = resource('Deployment', 'same', { app: 'same' });
    expect(() => correlateResources([item, item])).toThrow('duplicate scoped UID');
    expect(() =>
      correlateResources([item, { ...item, identity: { ...item.identity, uid: 'new' } }])
    ).toThrow('duplicate scoped name');
  });
});

describe('Service host correlation', () => {
  const service = resource('Service', 'reviews');
  it.each([
    'reviews',
    'reviews.bookinfo',
    'reviews.bookinfo.svc',
    'reviews.bookinfo.svc.cluster.local',
    'REVIEWS.BOOKINFO.SVC.CLUSTER.LOCAL.',
  ])('resolves the supported DNS form %s', host => {
    expect(resolveServiceHost(host, 'alpha', 'bookinfo', [service])).toBe(service);
  });
  it.each([
    'reviews.other',
    'reviews.example.com',
    '*.bookinfo.svc.cluster.local',
    'reviews.bookinfo.svc.cluster.local.evil',
  ])('does not fabricate an external or wildcard Service mapping for %s', host => {
    expect(resolveServiceHost(host, 'alpha', 'bookinfo', [service])).toBeNull();
  });
  it('does not resolve short names across namespaces or clusters', () => {
    expect(resolveServiceHost('reviews', 'alpha', 'other', [service])).toBeNull();
    expect(resolveServiceHost('reviews', 'beta', 'bookinfo', [service])).toBeNull();
  });
});
