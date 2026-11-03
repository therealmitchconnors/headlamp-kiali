import type { CorrelationResource, OwnerReference } from './correlation';
import { gatewaySelectorChecks, gatewayWorkloadProjection } from './gatewayWorkloads';
import { controlPlaneObservation } from './mesh';
import { initialValidation } from './validation';
import type { VirtualWorkloadGroup, VirtualWorkloadRecord } from './virtualWorkloads';

function resource(
  kind: CorrelationResource['identity']['kind'],
  name = kind.toLowerCase(),
  namespace = 'bookinfo',
  labels = { app: 'gateway' },
  owners: OwnerReference[] = []
): CorrelationResource {
  return {
    identity: {
      cluster: 'alpha',
      group: kind === 'Pod' ? '' : 'apps',
      kind,
      namespace,
      name,
      uid: `${namespace}/${kind}/${name}`,
    },
    resourceVersion: '1',
    labels: { metadata: 'only' },
    workloadLabels: labels,
    owners,
    serviceSelector: null,
    proxyMode: 'none',
  };
}
const owner = (parent: CorrelationResource, controller = true): OwnerReference => ({
  group: parent.identity.group,
  kind: parent.identity.kind,
  name: parent.identity.name,
  uid: parent.identity.uid,
  controller,
});
const project = (
  resources: CorrelationResource[],
  groups: VirtualWorkloadGroup[] = [],
  entries: VirtualWorkloadRecord[] = []
) => gatewayWorkloadProjection('alpha', ['bookinfo', 'edge'], resources, groups, entries);
const selector = (
  items: ReturnType<typeof project>,
  spec: Record<string, unknown> = { selector: { app: 'gateway' } },
  scopeToNamespace = false
) =>
  gatewaySelectorChecks('bookinfo', spec, {
    complete: true,
    namespaces: ['bookinfo', 'edge'],
    scopeToNamespace,
    items,
  });

it.each(['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet'] as const)(
  'uses %s template labels even with no Pods, without requiring gateway annotations',
  kind => {
    const items = project([resource(kind)]);
    expect(items).toHaveLength(1);
    expect(items[0].labels).toEqual({ app: 'gateway' });
    expect(selector(items)).toEqual([]);
    expect(selector(items, { selector: { metadata: 'only' } })).toMatchObject([
      { code: 'KIA0302', path: 'spec/selector', severity: 'warning' },
    ]);
  }
);
it('uses metadata labels only for standalone Pods and never their correlation proxyMode', () => {
  const pod = resource('Pod');
  pod.labels = { app: 'gateway' };
  pod.workloadLabels = { template: 'not-a-pod-field' };
  expect(selector(project([pod]))).toEqual([]);
});
it.each([true, false])('retains pooled versus namespace-scoped controller selection: %s', scope => {
  expect(
    selector(project([resource('Deployment', 'edge-gateway', 'edge')]), undefined, scope)
  ).toHaveLength(scope ? 1 : 0);
});
it.each([undefined, null, {}])(
  'empty/nil Gateway selector matches any workload, but not an empty pool: %j',
  match => {
    const context = { complete: true, namespaces: ['bookinfo', 'edge'], scopeToNamespace: false };
    expect(
      gatewaySelectorChecks(
        'bookinfo',
        { selector: match },
        { ...context, items: project([resource('Deployment')]) }
      )
    ).toEqual([]);
    expect(
      gatewaySelectorChecks('bookinfo', { selector: match }, { ...context, items: [] })
    ).toMatchObject([{ code: 'KIA0302' }]);
  }
);
it('does not count owned Pods or child ReplicaSets as targets, even if only their labels match', () => {
  const deployment = resource('Deployment', 'root', 'bookinfo', { app: 'not-gateway' });
  const rs = resource('ReplicaSet', 'child', 'bookinfo', { app: 'gateway' }, [owner(deployment)]);
  const pod = resource('Pod', 'leaf', 'bookinfo', { app: 'gateway' }, [owner(rs)]);
  pod.labels = { app: 'gateway' };
  const items = project([pod, rs, deployment]);
  expect(items.map(item => item.kind)).toEqual(['Deployment']);
  expect(selector(items)).toHaveLength(1);
});
it('includes a ReplicaSet with only non-controller references only when seeded by a Pod', () => {
  const ref = resource('Deployment', 'annotation-owner');
  const rs = resource('ReplicaSet', 'child', 'bookinfo', { app: 'gateway' }, [owner(ref, false)]);
  const pod = resource('Pod', 'leaf', 'bookinfo', { app: 'gateway' }, [owner(rs)]);
  expect(project([rs])).toEqual([]);
  expect(project([rs, pod]).map(item => item.kind)).toEqual(['ReplicaSet']);
});
it.each(['Job', 'CronJob', 'ReplicationController', 'DeploymentConfig'])(
  'does not promote Pods with a pinned-default excluded %s owner into targets',
  kind => {
    const pod = resource('Pod');
    pod.owners = [
      {
        kind,
        group: kind === 'Job' || kind === 'CronJob' ? 'batch' : '',
        name: 'excluded',
        uid: 'excluded',
        controller: true,
      },
    ];
    expect(project([pod])).toEqual([]);
  }
);
it.each(['Pod', 'ReplicaSet'] as const)('fails closed on custom %s controllers', kind => {
  const child = resource(kind);
  child.owners = [
    { kind: 'Rollout', group: 'argoproj.io', name: 'rollout', uid: 'rollout', controller: true },
  ];
  expect(() => project([child])).toThrow(/Custom/);
});
it.each(['missing', 'stale', 'wrong-group', 'multiple'])(
  'rejects %s ownership instead of guessing inclusion',
  mode => {
    const deployment = resource('Deployment');
    const pod = resource('Pod');
    pod.owners = [owner(deployment)];
    if (mode === 'stale') pod.owners[0].uid = 'old';
    if (mode === 'wrong-group') pod.owners[0].group = 'other';
    if (mode === 'multiple') pod.owners = [...pod.owners, owner(deployment)];
    expect(() => project(mode === 'missing' ? [pod] : [pod, deployment])).toThrow();
  }
);
const group: VirtualWorkloadGroup = {
  name: 'vm',
  namespace: 'bookinfo',
  uid: 'vm',
  resourceVersion: '1',
  labels: { metadata: 'ignored' },
  selector: { app: 'gateway' },
};
const entry: VirtualWorkloadRecord = {
  name: 'entry',
  namespace: 'edge',
  uid: 'entry',
  resourceVersion: '1',
  labels: { app: 'gateway', entry: 'first' },
};
it('uses the first matching WorkloadEntry in captured pool order without a namespace re-filter', () => {
  const items = project(
    [],
    [group],
    [
      entry,
      { ...entry, uid: 'second', name: 'second', labels: { app: 'gateway', entry: 'second' } },
    ]
  );
  expect(items[0].labels).toEqual(entry.labels);
  expect(items[0].entry).toEqual({
    name: 'entry',
    namespace: 'edge',
    uid: 'entry',
    resourceVersion: '1',
  });
});
it('uses group spec labels only after complete entry evidence; empty selectors never import entries', () => {
  expect(project([], [group], [])[0].labels).toEqual(group.selector);
  expect(project([], [{ ...group, selector: {} }], [entry])[0].labels).toEqual({});
});
it.each(['cluster', 'namespace', 'version', 'uid', 'duplicate', 'name-collision'])(
  'rejects %s identity evidence',
  mode => {
    const first = resource('Deployment');
    const second = resource('ReplicaSet', 'other');
    if (mode === 'cluster') first.identity = { ...first.identity, cluster: 'beta' };
    if (mode === 'namespace') first.identity.namespace = 'outside';
    if (mode === 'version') first.resourceVersion = undefined;
    if (mode === 'uid') first.identity.uid = '';
    if (mode === 'duplicate') second.identity.uid = first.identity.uid;
    if (mode === 'name-collision')
      second.identity = { ...second.identity, name: first.identity.name };
    expect(() => project([first, second])).toThrow();
  }
);
it('requires explicit complete declared scope and honors KIA0302 suppression in the active Istio Gateway path', () => {
  const input = {
    cluster: 'alpha',
    namespace: 'bookinfo',
    kind: 'Gateway',
    group: 'networking.istio.io',
    spec: { selector: { app: 'gateway' }, servers: [] },
    annotations: {},
    workloads: [],
    complete: false,
    gatewayWorkloads: {
      complete: false,
      namespaces: ['bookinfo'],
      scopeToNamespace: false,
      items: [],
    },
  };
  expect(initialValidation(input).findings).toEqual([]);
  expect(initialValidation(input).skipped.join()).toContain('complete declared');
  const complete = { ...input, gatewayWorkloads: { ...input.gatewayWorkloads, complete: true } };
  expect(initialValidation(complete).findings).toMatchObject([{ code: 'KIA0302' }]);
  expect(
    initialValidation({ ...complete, annotations: { 'kiali.io/ignore-validations': 'KIA0302' } })
  ).toMatchObject({ findings: [], suppressed: 1 });
  expect(
    initialValidation({ ...complete, group: 'gateway.networking.k8s.io' }).findings.some(
      item => item.code === 'KIA0302'
    )
  ).toBe(false);
});
it('enforces projection and label budgets', () => {
  expect(() => project(Array.from({ length: 7001 }, () => resource('Deployment')))).toThrow(
    'limits'
  );
  const many = Array.from({ length: 41 }, (_, index) => {
    const current = resource('Deployment', `d-${index}`);
    current.labels = Object.fromEntries(
      Array.from({ length: 250 }, (_, label) => [`label-${label}`, 'value'])
    );
    current.workloadLabels = current.labels;
    return current;
  });
  expect(project(many.slice(0, 40))).toHaveLength(40);
  expect(() => project(many)).toThrow('20000 labels');
});

const observe = (env: unknown, secondEnv: unknown = []) =>
  controlPlaneObservation({
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: 'istiod',
      namespace: 'istio-system',
      uid: 'cp',
      resourceVersion: '1',
      labels: { app: 'istiod' },
    },
    spec: {
      replicas: 1,
      template: {
        spec: {
          containers: [
            { name: 'first', env },
            { name: 'discovery', env: secondEnv },
          ],
        },
      },
    },
    status: { replicas: 1, availableReplicas: 1 },
  });
const scopeEnv = 'PILOT_SCOPE_GATEWAY_TO_NAMESPACE';
it.each([
  { env: [], expected: false },
  { env: [{ name: scopeEnv, value: 'true' }], expected: true },
  { env: [{ name: scopeEnv, value: 'false' }], expected: false },
  {
    env: [
      { name: scopeEnv, value: 'true' },
      { name: scopeEnv, value: 'false' },
    ],
    expected: true,
  },
  {
    env: [
      { name: scopeEnv, value: 'false' },
      { name: scopeEnv, value: 'true' },
    ],
    expected: true,
  },
])('accumulates only exact-true Gateway scope declarations: %#', ({ env, expected }) => {
  expect(observe(env).scopeGatewayToNamespace).toBe(expected);
});
it.each(['1', 'TRUE', 'True', 'true ', '0'])(
  'guards noncanonical Gateway scope %j without blocking unrelated mesh configuration',
  value => {
    const result = observe([{ name: scopeEnv, value }]);
    expect(result.scopeGatewayToNamespace).toBeNull();
    expect(result.effectiveConfigBlocked).toBe(false);
    expect(result.configurationWarnings).toContain(`${scopeEnv} is not resolved`);
  }
);
it('guards any scope indirection and does not read a discovery-named sibling', () => {
  expect(
    observe([
      { name: scopeEnv, valueFrom: { configMapKeyRef: { name: 'external', key: 'value' } } },
      { name: scopeEnv, value: 'true' },
    ]).scopeGatewayToNamespace
  ).toBeNull();
  expect(observe([], [{ name: scopeEnv, value: 'true' }]).scopeGatewayToNamespace).toBe(false);
});
