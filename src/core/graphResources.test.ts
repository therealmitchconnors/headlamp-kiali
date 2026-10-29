import { getClusterConfig } from './config';
import { CorrelationResource } from './correlation';
import {
  captureGraphResourceTarget,
  graphResourceCandidates,
  graphResourceTarget,
} from './graphResources';
import { TopologyNode } from './topology';

const node: TopologyNode = {
  id: 'node',
  cluster: 'mesh-east',
  namespace: 'bookinfo',
  kind: 'workload',
  label: 'reviews-v1',
  workloads: ['reviews-v1'],
  apps: ['reviews'],
  versions: ['v1'],
};
const current = { cluster: 'alpha', telemetryCluster: 'mesh-east' };
const config = {
  schemaVersion: 1 as const,
  clusters: { beta: { prometheus: null, telemetryCluster: 'mesh-west' } },
};
const target = {
  cluster: 'alpha',
  namespace: 'bookinfo',
  kind: 'workload' as const,
  names: ['reviews-v1'],
};
const resource: CorrelationResource = {
  identity: {
    cluster: 'alpha',
    namespace: 'bookinfo',
    group: 'apps',
    kind: 'Deployment',
    name: 'reviews-v1',
    uid: 'current-uid',
  },
  labels: {},
  workloadLabels: { app: 'reviews', version: 'v1' },
  owners: [],
  serviceSelector: null,
  proxyMode: 'none',
};
it('uses only an explicit captured/current or uniquely configured telemetry mapping', () => {
  expect(graphResourceTarget(node, current, config, ['alpha', 'beta'])).toEqual(target);
  expect(
    graphResourceTarget({ ...node, cluster: 'mesh-west' }, current, config, ['alpha', 'beta'])
      .cluster
  ).toBe('beta');
  expect(() =>
    graphResourceTarget({ ...node, cluster: 'beta' }, current, config, ['alpha', 'beta'])
  ).toThrow('No explicit');
  expect(() =>
    graphResourceTarget(
      node,
      current,
      {
        ...config,
        clusters: { beta: { ...getClusterConfig(config, 'beta'), telemetryCluster: 'mesh-east' } },
      },
      ['alpha', 'beta']
    )
  ).toThrow('multiple Headlamp');
  expect(() =>
    graphResourceTarget({ ...node, cluster: 'mesh-west' }, current, config, ['alpha'])
  ).toThrow('No explicit');
});
it('validates reported names and bounds without parsing application display labels as resource names', () => {
  expect(
    graphResourceTarget({ ...node, kind: 'app', label: 'arbitrary display @v1' }, current, config, [
      'alpha',
    ]).names
  ).toEqual(['reviews-v1']);
  expect(
    graphResourceTarget({ ...node, kind: 'service', label: 'reviews' }, current, config, ['alpha'])
      .names
  ).toEqual(['reviews']);
  for (const changes of [
    { kind: 'unknown' as const },
    { cluster: 'unknown' },
    { workloads: [] },
    { workloads: ['../bad'] },
    { namespace: 'unknown/namespace' },
  ])
    expect(() =>
      graphResourceTarget({ ...node, ...changes }, current, config, ['alpha'])
    ).toThrow();
  expect(
    captureGraphResourceTarget({
      ...target,
      names: Array.from({ length: 20 }, (_, i) => `name-${i}`),
    }).names
  ).toHaveLength(20);
  expect(() =>
    captureGraphResourceTarget({
      ...target,
      names: Array.from({ length: 21 }, (_, i) => `name-${i}`),
    })
  ).toThrow();
});
it('returns current UID/name candidates while rejecting ambiguous kinds and scope leakage', () => {
  expect(graphResourceCandidates(target, [resource])).toEqual({
    candidates: [{ identity: resource.identity, app: 'reviews', version: 'v1' }],
    unresolved: [],
  });
  const second = {
    ...resource,
    identity: { ...resource.identity, kind: 'StatefulSet' as const, uid: 'other-uid' },
  };
  expect(graphResourceCandidates(target, [resource, second])).toEqual({
    candidates: [],
    unresolved: [{ name: 'reviews-v1', reason: 'ambiguous' }],
  });
  expect(graphResourceCandidates(target, [])).toEqual({
    candidates: [],
    unresolved: [{ name: 'reviews-v1', reason: 'not-observed' }],
  });
  expect(() =>
    graphResourceCandidates(target, [
      { ...resource, identity: { ...resource.identity, cluster: 'beta' } },
    ])
  ).toThrow('outside');
});
it('matches Services separately and defers unresolved workload ownership', () => {
  const service: CorrelationResource = {
    ...resource,
    identity: {
      ...resource.identity,
      kind: 'Service',
      group: '',
      name: 'reviews',
      uid: 'service-uid',
    },
  };
  expect(
    graphResourceCandidates({ ...target, kind: 'service', names: ['reviews'] }, [service, resource])
      .candidates[0].identity
  ).toEqual(service.identity);
  const owned = {
    ...resource,
    owners: [
      { group: 'custom.io', kind: 'Custom', name: 'owner', uid: 'missing', controller: true },
    ],
  };
  expect(() => graphResourceCandidates(target, [owned])).toThrow('Unresolved workload ownership');
});
