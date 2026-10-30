import { CorrelationKind, CorrelationResource } from './correlation';
import { namespaceScope } from './scope';
import { captureWorkloadDashboardEvidence, workloadDashboardSelectors } from './workloadDashboards';

const scope = namespaceScope('alpha', 'bookinfo');
function resource(
  kind: CorrelationKind,
  name: string,
  parent?: CorrelationResource
): CorrelationResource {
  return {
    identity: {
      cluster: 'alpha',
      namespace: 'bookinfo',
      kind,
      name,
      uid: `${kind}-${name}`,
      group: ['Deployment', 'ReplicaSet'].includes(kind)
        ? 'apps'
        : ['Job', 'CronJob'].includes(kind)
        ? 'batch'
        : '',
    },
    resourceVersion: '17',
    labels: { app: 'reviews', version: 'v2' },
    workloadLabels: { app: 'reviews', version: 'v2' },
    owners: parent ? [{ ...parent.identity, controller: true }] : [],
    serviceSelector: null,
    proxyMode: 'none',
    ...(kind === 'Pod'
      ? { dashboardRefs: { ok: true as const, refs: ['runtime'], bytes: 7 } }
      : {}),
  };
}
function deploymentTree() {
  const root = resource('Deployment', 'reviews');
  const first = resource('ReplicaSet', 'first', root);
  const second = resource('ReplicaSet', 'second', root);
  const p1 = resource('Pod', 'first-pod', first);
  const p2 = resource('Pod', 'second-pod', second);
  return [root, first, second, p1, p2];
}
it('captures a Deployment and all of its UID-owned descendant Pods without mutating the tree', () => {
  const input = deploymentTree();
  const original = structuredClone(input);
  const evidence = captureWorkloadDashboardEvidence(scope, input, true, {
    kind: 'Deployment',
    name: 'reviews',
    uid: 'Deployment-reviews',
  });
  expect(evidence.pods.map(pod => pod.name)).toEqual(['first-pod', 'second-pod']);
  expect(evidence.workload).toEqual({
    kind: 'Deployment',
    name: 'reviews',
    uid: 'Deployment-reviews',
    resourceVersion: '17',
    version: 'v2',
  });
  expect(evidence.selectors[2].filters).toEqual({ app: 'reviews', version: 'v2' });
  expect(input).toEqual(original);
});
it('roots child ReplicaSet and Pod inspection at the selected identity, excluding sibling and ancestor Pods', () => {
  const input = deploymentTree();
  expect(
    captureWorkloadDashboardEvidence(scope, input, true, {
      kind: 'ReplicaSet',
      name: 'first',
    }).pods.map(pod => pod.name)
  ).toEqual(['first-pod']);
  expect(
    captureWorkloadDashboardEvidence(scope, input, true, {
      kind: 'Pod',
      name: 'second-pod',
    }).pods.map(pod => pod.name)
  ).toEqual(['second-pod']);
});
it('supports a Job within a CronJob without attributing its sibling executions', () => {
  const cron = resource('CronJob', 'cron');
  const job = resource('Job', 'run', cron);
  const other = resource('Job', 'other', cron);
  const pod = resource('Pod', 'run-pod', job);
  const extra = resource('Pod', 'other-pod', other);
  const input = [cron, job, other, pod, extra];
  expect(
    captureWorkloadDashboardEvidence(scope, input, true, { kind: 'Job', name: 'run' }).pods.map(
      pod => pod.name
    )
  ).toEqual(['run-pod']);
  expect(
    captureWorkloadDashboardEvidence(scope, input, true, { kind: 'CronJob', name: 'cron' }).pods
  ).toHaveLength(2);
});
it.each([
  (input: CorrelationResource[]) => {
    input[0].resourceVersion = undefined;
  },
  (input: CorrelationResource[]) => {
    input[0].identity.uid = ' ';
  },
  (input: CorrelationResource[]) => {
    input[0].identity = { ...input[0].identity, group: 'other' };
  },
  (input: CorrelationResource[]) => {
    input[0].identity.namespace = 'other';
  },
  (input: CorrelationResource[]) => {
    input[0].workloadLabels = { app: '', version: 'v1' };
  },
  (input: CorrelationResource[]) => {
    input[3].dashboardRefs = { ok: false, message: 'bad references' };
  },
])('rejects missing or invalid captured scope/evidence (%#)', mutate => {
  const input = deploymentTree();
  mutate(input);
  expect(() =>
    captureWorkloadDashboardEvidence(scope, input, true, { kind: 'Deployment', name: 'reviews' })
  ).toThrow();
});
it('does not reinterpret a name-reused workload or unresolved owner as a complete snapshot', () => {
  const input = deploymentTree();
  expect(() =>
    captureWorkloadDashboardEvidence(scope, input, true, {
      kind: 'Deployment',
      name: 'reviews',
      uid: 'old',
    })
  ).toThrow('UID');
  input[3].owners = [
    { group: 'apps', kind: 'ReplicaSet', name: 'missing', uid: 'missing', controller: true },
  ];
  const evidence = captureWorkloadDashboardEvidence(scope, input, true, {
    kind: 'Deployment',
    name: 'reviews',
  });
  expect(evidence.complete).toBe(false);
  expect(evidence.pods.map(pod => pod.name)).toEqual(['second-pod']);
});
it('pairs app and version label conventions in pinned order, including mixed observed naming schemes', () => {
  const input = deploymentTree();
  input[0].workloadLabels = {
    'service.istio.io/canonical-name': 'canonical-app',
    version: 'legacy-version',
  };
  const evidence = captureWorkloadDashboardEvidence(scope, input, true, {
    kind: 'Deployment',
    name: 'reviews',
  });
  expect(evidence.selectors.map(selector => selector.filters)).toEqual([
    {
      service_istio_io_canonical_name: 'canonical-app',
      service_istio_io_canonical_revision: 'legacy-version',
    },
    { app_kubernetes_io_name: 'canonical-app', app_kubernetes_io_version: 'legacy-version' },
    { app: 'canonical-app', version: 'legacy-version' },
  ]);
});
it('omits only empty/missing version values, without guessing a version or losing the app filter', () => {
  expect(workloadDashboardSelectors('reviews', '')[2]).toEqual({
    label: 'app',
    metricLabel: 'app',
    filters: { app: 'reviews' },
  });
  const input = deploymentTree();
  input[0].workloadLabels = { app: 'reviews' };
  const evidence = captureWorkloadDashboardEvidence(scope, input, false, {
    kind: 'Deployment',
    name: 'reviews',
  });
  expect(evidence).toMatchObject({ complete: false, workload: { version: '' } });
  expect(evidence.selectors[0].filters).toEqual({ service_istio_io_canonical_name: 'reviews' });
});
it('uses one configured pair and rejects invalid or colliding version keys before transport', () => {
  expect(
    workloadDashboardSelectors('reviews', 'v1', {
      app: 'custom.io/app',
      version: 'custom.io/version',
    })
  ).toEqual([
    {
      label: 'custom.io/app',
      metricLabel: 'custom_io_app',
      versionLabel: 'custom.io/version',
      metricVersionLabel: 'custom_io_version',
      filters: { custom_io_app: 'reviews', custom_io_version: 'v1' },
    },
  ]);
  expect(() =>
    workloadDashboardSelectors('reviews', 'v1', { app: 'app-key', version: 'app.key' })
  ).toThrow('collide');
  expect(() => workloadDashboardSelectors('reviews', 'bad value')).toThrow('version label');
  expect(() =>
    workloadDashboardSelectors('reviews', 'v1', { app: 'app', version: 'bad key' })
  ).toThrow('key');
});
