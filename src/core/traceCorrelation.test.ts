import { CorrelationResource, OwnerReference } from './correlation';
import { namespaceScope } from './scope';
import { reportedTracePod, traceCurrentWorkload, tracePodIdentity } from './traceCorrelation';
import { TraceAttribute, TraceValue } from './tracing';

const attrs = (values: Record<string, TraceValue>): TraceAttribute[] =>
  Object.entries(values).map(([key, value]) => ({ key, value }));
const identity = {
  'k8s.namespace.name': 'bookinfo',
  'k8s.pod.name': 'reviews-1',
  'k8s.pod.uid': 'reported-uid',
};
const reportedIdentity = { namespace: 'bookinfo', name: 'reviews-1', uid: 'reported-uid' };
const scope = namespaceScope('alpha', 'bookinfo');
const owner = (kind: string, name: string, uid: string): OwnerReference => ({
  group: kind === 'Job' || kind === 'CronJob' ? 'batch' : 'apps',
  kind,
  name,
  uid,
  controller: true,
});
const resource = (
  kind: CorrelationResource['identity']['kind'],
  name: string,
  uid: string,
  owners: OwnerReference[] = [],
  workloadLabels: Record<string, string> = {}
): CorrelationResource => ({
  identity: {
    cluster: 'alpha',
    namespace: 'bookinfo',
    group: kind === 'Pod' ? '' : 'apps',
    kind,
    name,
    uid,
  },
  labels: {},
  workloadLabels,
  owners,
  serviceSelector: null,
  proxyMode: 'none',
});
const ownedResources = () => [
  resource('Pod', 'reviews-1', 'reported-uid', [owner('ReplicaSet', 'reviews-abc', 'rs-uid')]),
  resource('ReplicaSet', 'reviews-abc', 'rs-uid', [
    owner('Deployment', 'reviews-v1', 'deploy-uid'),
  ]),
  resource('Deployment', 'reviews-v1', 'deploy-uid', [], { app: 'reviews', version: 'v1' }),
];

it('requires all three explicit identity fields and never derives them from service or cluster labels', () => {
  expect(
    reportedTracePod({
      attributes: [],
      resourceAttributes: attrs({
        'service.name': 'reviews.bookinfo',
        'k8s.cluster.name': 'alpha',
      }),
    })
  ).toEqual({ status: 'unavailable', reason: 'absent' });
  expect(
    reportedTracePod({
      attributes: [],
      resourceAttributes: attrs({ 'k8s.namespace.name': 'bookinfo', 'k8s.pod.name': 'reviews-1' }),
    })
  ).toEqual({ status: 'unavailable', reason: 'incomplete' });
  expect(reportedTracePod({ attributes: [], resourceAttributes: attrs(identity) })).toMatchObject({
    status: 'ready',
    origin: 'resource',
    identity: { namespace: 'bookinfo', name: 'reviews-1', uid: 'reported-uid' },
  });
});

it('resolves a current workload through the complete UID owner chain and keeps identities separate', () => {
  const result = traceCurrentWorkload(scope, reportedIdentity, ownedResources());
  expect(result).toEqual({
    pod: {
      cluster: 'alpha',
      namespace: 'bookinfo',
      group: '',
      kind: 'Pod',
      name: 'reviews-1',
      uid: 'reported-uid',
    },
    workload: {
      cluster: 'alpha',
      namespace: 'bookinfo',
      group: 'apps',
      kind: 'Deployment',
      name: 'reviews-v1',
      uid: 'deploy-uid',
    },
    application: { cluster: 'alpha', namespace: 'bookinfo', name: 'reviews' },
  });
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.workload)).toBe(true);
});

it.each([
  ['deleted Pod', []],
  ['replaced Pod', [resource('Pod', 'reviews-1', 'new-uid')]],
])('does not resolve a %s from a name-only snapshot', (_reason, resources) => {
  expect(() => traceCurrentWorkload(scope, reportedIdentity, resources)).toThrow(
    /current|replaced/i
  );
});

it('rejects mismatched, ambiguous, cyclic, and unsupported owner chains', () => {
  const resources = ownedResources();
  expect(() =>
    traceCurrentWorkload(scope, reportedIdentity, [
      resources[0],
      { ...resources[1], identity: { ...resources[1].identity, uid: 'different-uid' } },
      resources[2],
    ])
  ).toThrow(/ownership/);
  expect(() =>
    traceCurrentWorkload(scope, reportedIdentity, [
      {
        ...resources[0],
        owners: [...resources[0].owners, owner('Job', 'other', 'other-uid')],
      },
      ...resources.slice(1),
    ])
  ).toThrow(/ownership/);
  const cyclic = [
    resource('Pod', 'reviews-1', 'reported-uid', [owner('ReplicaSet', 'reviews-abc', 'rs-uid')]),
    resource('ReplicaSet', 'reviews-abc', 'rs-uid', [owner('Pod', 'reviews-1', 'reported-uid')]),
  ];
  expect(() => traceCurrentWorkload(scope, reportedIdentity, cyclic)).toThrow(/ownership/);
  expect(() =>
    traceCurrentWorkload(scope, reportedIdentity, [resource('Pod', 'reviews-1', 'reported-uid')])
  ).toThrow(/supported workload owner/);
});

it('rejects resource snapshots that collide across contexts or namespaces', () => {
  expect(() =>
    traceCurrentWorkload(scope, reportedIdentity, [
      ...ownedResources(),
      { ...ownedResources()[2], identity: { ...ownedResources()[2].identity, cluster: 'beta' } },
    ])
  ).toThrow(/outside the captured scope/);
  expect(() =>
    traceCurrentWorkload(scope, reportedIdentity, [
      ...ownedResources(),
      {
        ...ownedResources()[2],
        identity: { ...ownedResources()[2].identity, namespace: 'other' },
      },
    ])
  ).toThrow(/outside the captured scope/);
});
it('retains explicit provenance and accepts identical repeated values without inventing precedence', () => {
  expect(reportedTracePod({ attributes: attrs(identity), resourceAttributes: [] })).toMatchObject({
    status: 'ready',
    origin: 'span',
  });
  expect(
    reportedTracePod({
      resourceAttributes: attrs({ 'k8s.namespace.name': 'bookinfo' }),
      attributes: attrs(identity),
    })
  ).toMatchObject({ status: 'ready', origin: 'mixed' });
  const repeated = [...attrs(identity), ...attrs(identity)];
  expect(reportedTracePod({ resourceAttributes: repeated, attributes: [] }).status).toBe('ready');
  expect(Object.isFrozen(tracePodIdentity('bookinfo', 'reviews-1', 'reported-uid'))).toBe(true);
});
it.each(['k8s.namespace.name', 'k8s.pod.name', 'k8s.pod.uid'])(
  'rejects conflicting %s rather than guessing which source wins',
  key => {
    expect(
      reportedTracePod({
        resourceAttributes: attrs(identity),
        attributes: attrs({ [key]: 'different' }),
      })
    ).toEqual({ status: 'unavailable', reason: 'conflicting' });
  }
);
it.each([
  { 'k8s.namespace.name': '../bookinfo' },
  { 'k8s.namespace.name': 'bookinfo\n' },
  { 'k8s.pod.name': '' },
  { 'k8s.pod.name': 'reviews/other' },
  { 'k8s.pod.uid': false },
  { 'k8s.pod.uid': '' },
  { 'k8s.pod.uid': 'uid\n' },
  { 'k8s.pod.uid': 'x'.repeat(257) },
])('rejects invalid reported identity %#', changes => {
  expect(
    reportedTracePod({ resourceAttributes: attrs({ ...identity, ...changes }), attributes: [] })
  ).toEqual({ status: 'unavailable', reason: 'invalid' });
});
it('bounds attribute inputs before attempting identity extraction', () => {
  expect(
    reportedTracePod({
      resourceAttributes: Array(257).fill({ key: 'other', value: 'x' }),
      attributes: [],
    })
  ).toEqual({ status: 'unavailable', reason: 'invalid' });
});
