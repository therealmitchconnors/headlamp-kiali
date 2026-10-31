import { controlPlaneObservation, MeshConfigFields, NamespaceObservation } from './mesh';
import { localManagedNamespaceProjection } from './meshMembership';

const controller = controlPlaneObservation({
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: {
    name: 'istiod-blue',
    namespace: 'istio-system',
    uid: 'cp',
    labels: { app: 'istiod', 'istio.io/rev': 'blue' },
  },
  spec: {
    replicas: 1,
    template: {
      spec: {
        containers: [{ name: 'discovery', env: [{ name: 'CLUSTER_ID', value: 'logical' }] }],
      },
    },
  },
  status: { replicas: 1, availableReplicas: 1 },
});
const fields: MeshConfigFields = { rootNamespace: 'policies', hasDiscoverySelectors: false };
const ns = (name: string, labels: Record<string, string> = {}): NamespaceObservation => ({
  name,
  labels,
});
const baseNamespaces = [ns('istio-system'), ns('policies')];
it('uses default visibility, first-tag replacement and declared revision semantics without confusing injection hints', () => {
  const result = localManagedNamespaceProjection(
    'logical',
    [
      ...baseNamespaces,
      ns('enabled', { 'istio-injection': 'enabled' }),
      ns('ambient', { 'istio.io/dataplane-mode': 'ambient' }),
      ns('conflicting', { 'istio-injection': 'enabled', 'istio.io/rev': 'other' }),
      ns('disabled-revision', { 'istio-injection': 'disabled', 'istio.io/rev': 'default' }),
      ns('raw-revision', { 'istio.io/rev': 'blue' }),
      ns('ignored-tag', { 'istio.io/rev': 'canary' }),
      ns('unselected'),
      ns('kube-system', { 'istio-injection': 'enabled' }),
      ns('openshiftmonitoring', { 'istio-injection': 'enabled' }),
      ns('ibm', { 'istio-injection': 'enabled' }),
      ns('kiali-operator-extra', { 'istio-injection': 'enabled' }),
      ns('istio-operator-extra', { 'istio-injection': 'enabled' }),
    ],
    [{ controller, fields }],
    [
      { name: 'first', revision: 'blue', tag: 'default' },
      { name: 'ignored', revision: 'blue', tag: 'canary' },
    ]
  );
  expect(result.membership.map(item => item.namespace)).toEqual([
    'istio-system',
    'policies',
    'enabled',
    'ambient',
    'conflicting',
    'disabled-revision',
  ]);
  expect(result.membership[0].controllers[0].basis).toBe('control-plane');
  expect(result.membership[1].controllers[0].basis).toBe('root');
  expect(result.unmanagedNamespaces).toEqual(['raw-revision', 'ignored-tag', 'unselected']);
  expect(result.excludedSystemNamespaces).toEqual([
    'kube-system',
    'openshiftmonitoring',
    'ibm',
    'kiali-operator-extra',
    'istio-operator-extra',
  ]);
});
it('filters revision members with Istio selectors while retaining visible own/root exceptions', () => {
  const selected = {
    rootNamespace: 'policies',
    hasDiscoverySelectors: true,
    discoverySelectors: [{ matchLabels: { team: 'blue' } }],
  };
  const result = localManagedNamespaceProjection(
    'logical',
    [
      ...baseNamespaces,
      ns('matching', { 'istio.io/rev': 'blue', team: 'blue' }),
      ns('excluded', { 'istio.io/rev': 'blue', team: 'red' }),
    ],
    [{ controller, fields: selected }],
    []
  );
  expect(result.membership.map(item => item.namespace)).toEqual([
    'istio-system',
    'policies',
    'matching',
  ]);
  expect(result.unmanagedNamespaces).toEqual(['excluded']);
  expect(() =>
    localManagedNamespaceProjection(
      'logical',
      baseNamespaces,
      [
        {
          controller,
          fields: {
            hasDiscoverySelectors: true,
            discoverySelectors: [{ matchExpressions: [{ key: 'team', operator: 'Bad' }] }],
          },
        },
      ],
      []
    )
  ).toThrow();
});
it('preserves every matching controller in captured order without choosing a unique configuration', () => {
  const second = { ...controller, uid: 'second', name: 'istiod-other' };
  const result = localManagedNamespaceProjection(
    'logical',
    [...baseNamespaces, ns('app', { 'istio.io/rev': 'blue' })],
    [
      { controller: second, fields },
      { controller, fields },
    ],
    []
  );
  expect(
    result.membership.find(item => item.namespace === 'app')?.controllers.map(item => item.uid)
  ).toEqual(['second', 'cp']);
  expect(result.controllerNamespaces).toEqual(['istio-system']);
});
it('does not allow own/root exceptions to bypass default Kiali system visibility', () => {
  const result = localManagedNamespaceProjection(
    'logical',
    [ns('kube-mesh'), ns('ibm-root')],
    [
      {
        controller: { ...controller, namespace: 'kube-mesh' },
        fields: { rootNamespace: 'ibm-root', hasDiscoverySelectors: false },
      },
    ],
    []
  );
  expect(result.membership).toEqual([]);
  expect(result.excludedSystemNamespaces).toEqual(['kube-mesh', 'ibm-root']);
});
it('uses the observed Maistra classifier and namespace key, not raw Istio revision tags', () => {
  const maistra = { ...controller, isMaistra: true };
  const result = localManagedNamespaceProjection(
    'logical',
    [
      ...baseNamespaces,
      ns('member', { 'maistra.io/member-of': 'istio-system' }),
      ns('ignored', {
        'maistra.io/member-of': 'istio-system',
        'maistra.io/ignore-namespace': 'false',
        'istio.io/rev': 'blue',
      }),
    ],
    [{ controller: maistra, fields }],
    [{ name: 'tag', revision: 'blue', tag: 'anything' }]
  );
  expect(result.membership.find(item => item.namespace === 'member')?.controllers[0].basis).toBe(
    'maistra-key'
  );
  expect(result.unmanagedNamespaces).toContain('ignored');
  expect(() =>
    localManagedNamespaceProjection(
      'logical',
      [...baseNamespaces, ns('coincident', { 'maistra.io/member-of': 'blue' })],
      [{ controller, fields }],
      []
    )
  ).toThrow('coincident non-Maistra');
});
it.each([
  { clusterId: undefined },
  { clusterId: 'other' },
  { managesExternal: true },
  { managesExternal: null },
  { effectiveConfigBlocked: true },
  { isMaistra: undefined },
  { revision: 'invalid value' },
])('rejects unsupported or unresolved controller scope %#', patch => {
  expect(() =>
    localManagedNamespaceProjection(
      'logical',
      baseNamespaces,
      [{ controller: { ...controller, ...patch }, fields }],
      []
    )
  ).toThrow();
});
it('rejects partial-looking inputs, duplicate identities and malformed namespace evidence', () => {
  expect(() => localManagedNamespaceProjection('logical', baseNamespaces, [], [])).toThrow(
    '1 to 20'
  );
  expect(() =>
    localManagedNamespaceProjection(
      'logical',
      baseNamespaces,
      [
        { controller, fields },
        { controller, fields },
      ],
      []
    )
  ).toThrow('unique');
  expect(() =>
    localManagedNamespaceProjection(
      'logical',
      [ns('app', { 'istio.io/rev': 'blue' })],
      [{ controller, fields }],
      []
    )
  ).toThrow('full namespace list');
  expect(() =>
    localManagedNamespaceProjection(
      'logical',
      [...baseNamespaces, ns('policies')],
      [{ controller, fields }],
      []
    )
  ).toThrow('unique namespace');
  expect(() =>
    localManagedNamespaceProjection(
      'logical',
      [...baseNamespaces, ns('bad', { 'invalid key': 'x' })],
      [{ controller, fields }],
      []
    )
  ).toThrow('valid label');
  expect(() =>
    localManagedNamespaceProjection('', baseNamespaces, [{ controller, fields }], [])
  ).toThrow('Logical mesh');
});
