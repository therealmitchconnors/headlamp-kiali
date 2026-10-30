import {
  controlPlaneObservation,
  injectorFields,
  mergeMeshFields,
  meshConfigFields,
  namespaceAssociations,
  namespaceObservation,
  resolvedMeshRoot,
  revisionConfigMapName,
  revisionTag,
  selectedRevisionTags,
  validationMeshRoot,
  validationOutboundPolicy,
} from './mesh';

it('resolves a known missing root from the observed controller namespace, not a conventional name', () => {
  for (const rootNamespace of [undefined, '']) {
    const fields = { rootNamespace, hasDiscoverySelectors: false };
    const root = resolvedMeshRoot(fields, 'custom-system');
    expect(root).toEqual({ namespace: 'custom-system', basis: 'controller-namespace' });
    expect(fields.rootNamespace).toBe(rootNamespace);
    expect(
      validationMeshRoot({ status: 'ready', controller: 'custom-system/istiod', fields, root })
    ).toBe('custom-system');
  }
  expect(
    resolvedMeshRoot({ rootNamespace: 'policies', hasDiscoverySelectors: false }, 'custom-system')
  ).toEqual({ namespace: 'policies', basis: 'configured' });
  expect(() =>
    validationMeshRoot({
      status: 'ready',
      controller: 'custom-system/istiod',
      fields: { hasDiscoverySelectors: false },
    })
  ).toThrow(/resolved mesh root/);
  expect(() =>
    validationMeshRoot({ status: 'unavailable', message: 'Configuration denied' })
  ).toThrow('Configuration denied');
});

it('retains the pinned outbound-policy default separately from observed configuration', () => {
  const fields = meshConfigFields('{}');
  expect(fields.outboundTrafficPolicy).toBeUndefined();
  expect(validationOutboundPolicy({ status: 'ready', controller: 'root/istiod', fields })).toEqual({
    mode: 'ALLOW_ANY',
    basis: 'kiali-default',
  });
  expect(() => validationOutboundPolicy(undefined)).toThrow(/resolved/);
  expect(() => validationOutboundPolicy({ status: 'unavailable', message: 'Mesh denied' })).toThrow(
    'Mesh denied'
  );
});

it.each([
  ['outboundTrafficPolicy: {}', 'REGISTRY_ONLY', 'protobuf-default'],
  ['outboundTrafficPolicy: {mode: null}', 'REGISTRY_ONLY', 'protobuf-default'],
  ['outboundTrafficPolicy: {mode: REGISTRY_ONLY}', 'REGISTRY_ONLY', 'explicit'],
  ['outboundTrafficPolicy: {mode: ALLOW_ANY}', 'ALLOW_ANY', 'explicit'],
  ['outboundTrafficPolicy: {mode: 0}', 'REGISTRY_ONLY', 'explicit'],
  ['outboundTrafficPolicy: {mode: 1}', 'ALLOW_ANY', 'explicit'],
  ['outboundTrafficPolicy: {mode: ALLOW_ANY_DYNAMIC_DNS}', 'ALLOW_ANY_DYNAMIC_DNS', 'explicit'],
  ['outboundTrafficPolicy: {mode: 3}', 'ALLOW_ANY_DYNAMIC_DNS', 'explicit'],
])('projects source outbound semantics for %s', (yaml, mode, basis) => {
  expect(meshConfigFields(yaml).outboundTrafficPolicy).toEqual({ mode, basis });
});

it('preserves a zero-valued local mode over shared policy while null policy inherits', () => {
  const shared = meshConfigFields('outboundTrafficPolicy: {mode: ALLOW_ANY}');
  expect(
    mergeMeshFields(meshConfigFields('outboundTrafficPolicy: {}'), shared).outboundTrafficPolicy
  ).toEqual({ mode: 'REGISTRY_ONLY', basis: 'protobuf-default' });
  expect(
    mergeMeshFields(meshConfigFields('outboundTrafficPolicy: null'), shared).outboundTrafficPolicy
  ).toEqual(shared.outboundTrafficPolicy);
  for (const yaml of [
    'outboundTrafficPolicy: true',
    'outboundTrafficPolicy: {mode: unknown}',
    'outboundTrafficPolicy: {mode: 2}',
  ])
    expect(() => meshConfigFields(yaml)).toThrow(/outbound traffic policy/);
});

const controller = {
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: {
    name: 'istiod-blue',
    namespace: 'istio-system',
    uid: 'controller-uid',
    generation: 1,
    labels: {
      app: 'istiod',
      'istio.io/rev': 'blue',
      'app.kubernetes.io/version': 'chart-not-runtime-version',
    },
  },
  spec: {
    replicas: 2,
    template: {
      spec: {
        containers: [
          {
            name: 'discovery',
            image: 'example.test/pilot:v1.30.5',
            env: [{ name: 'CLUSTER_ID', value: 'mesh-east' }],
          },
        ],
      },
    },
  },
  status: { observedGeneration: 1, replicas: 2, availableReplicas: 2 },
};

it('derives only reported controller identity and replica state, not a chart-label runtime version', () => {
  const found = controlPlaneObservation(controller);
  expect(found).toMatchObject({
    name: 'istiod-blue',
    namespace: 'istio-system',
    revision: 'blue',
    image: 'example.test/pilot:v1.30.5',
    clusterId: 'mesh-east',
    stale: false,
    replicas: { desiredReplicas: 2, currentReplicas: 2, availableReplicas: 2, syncedProxies: -1 },
  });
  expect(found.configurationWarnings).toEqual([]);
  expect(() =>
    controlPlaneObservation({
      ...controller,
      metadata: { ...controller.metadata, labels: { app: 'other' } },
    })
  ).toThrow('selector');
});
it('keeps shared, mounted, indirect and external configuration uncertainty visible', () => {
  const found = controlPlaneObservation({
    ...controller,
    spec: {
      ...controller.spec,
      template: {
        spec: {
          containers: [
            {
              ...controller.spec.template.spec.containers[0],
              env: [
                { name: 'SHARED_MESH_CONFIG', value: 'shared' },
                {
                  name: 'CLUSTER_ID',
                  valueFrom: { secretKeyRef: { name: 'not-read', key: 'id' } },
                },
                { name: 'EXTERNAL_ISTIOD', value: 'true' },
              ],
              args: ['--meshConfigFile=/custom/mesh'],
              volumeMounts: [{ name: 'custom', mountPath: '/etc/istio/config' }],
            },
          ],
          volumes: [{ name: 'custom', configMap: { name: 'different-config' } }],
        },
      },
    },
  });
  expect(found.clusterId).toBeUndefined();
  expect(found.sharedMeshConfig).toBe('shared');
  expect(found.effectiveConfigBlocked).toBe(true);
  for (const fragment of ['indirection', 'External', 'Explicit', 'Mounted'])
    expect(found.configurationWarnings.some(warning => warning.includes(fragment))).toBe(true);
});
it('observes the first declared container rather than preferring a discovery-named sibling', () => {
  const first = {
    name: 'first',
    image: 'first:image',
    env: [
      { name: 'CLUSTER_ID', value: 'first-cluster' },
      { name: 'SHARED_MESH_CONFIG', value: 'first-shared' },
    ],
  };
  const input = {
    ...controller,
    spec: {
      ...controller.spec,
      template: {
        spec: {
          containers: [
            first,
            { ...controller.spec.template.spec.containers[0], args: ['--meshConfigFile=/ignored'] },
          ],
        },
      },
    },
  };
  const observed = controlPlaneObservation(input);
  expect(observed).toMatchObject({
    configurationContainer: 'first',
    image: 'first:image',
    clusterId: 'first-cluster',
    sharedMeshConfig: 'first-shared',
    effectiveConfigBlocked: false,
  });
  input.spec.template.spec.containers.reverse();
  expect(controlPlaneObservation(input)).toMatchObject({
    configurationContainer: 'discovery',
    clusterId: 'mesh-east',
    effectiveConfigBlocked: true,
  });
});
it('does not skip malformed first containers and keeps missing-container configuration blocked', () => {
  const input = (containers: unknown) => ({
    ...controller,
    spec: { ...controller.spec, template: { spec: { containers } } },
  });
  expect(() => controlPlaneObservation(input('invalid'))).toThrow('container list');
  expect(() =>
    controlPlaneObservation(input([null, controller.spec.template.spec.containers[0]]))
  ).toThrow('first istiod container');
  expect(controlPlaneObservation(input([]))).toMatchObject({
    configurationContainer: undefined,
    effectiveConfigBlocked: true,
    configurationWarnings: ['The first declared container was not found'],
  });
});
it('uses the pinned standard ConfigMap naming while validating API-safe names', () => {
  expect(revisionConfigMapName('istio', 'default')).toBe('istio');
  expect(revisionConfigMapName('istio', '')).toBe('istio');
  expect(revisionConfigMapName('istio-sidecar-injector', 'asm-1-30')).toBe(
    'istio-sidecar-injector-asm-1-30'
  );
  expect(() => revisionConfigMapName('istio', '../unsafe')).toThrow();
});
it('preserves reported false and absent fields instead of applying unobserved mesh defaults', () => {
  expect(
    meshConfigFields(
      'rootNamespace: istio-system\ntrustDomain: trust.example\ntrustDomainAliases: [alias.example]\nenableAutoMtls: false'
    )
  ).toMatchObject({
    rootNamespace: 'istio-system',
    trustDomain: 'trust.example',
    trustDomainAliases: ['alias.example'],
    enableAutoMtls: false,
  });
  expect(meshConfigFields('{}').enableAutoMtls).toBeUndefined();
  expect(meshConfigFields('{}').trustDomain).toBeUndefined();
  expect(
    injectorFields('{"global":{"network":"","meshID":"","proxy":{"clusterDomain":"dns.example"}}}')
  ).toEqual({
    network: '',
    meshId: '',
    clusterDomain: 'dns.example',
    serviceIdentityDomain: 'svc.dns.example',
  });
});
it('rejects malformed or oversized configuration without leaking parser source excerpts', () => {
  expect(() => meshConfigFields('!unsupported secret-sentinel')).toThrow('Invalid mesh YAML');
  try {
    meshConfigFields('!unsupported secret-sentinel');
  } catch (error) {
    expect(String(error)).not.toContain('secret-sentinel');
  }
  expect(() => meshConfigFields('enableAutoMtls: not-a-boolean')).toThrow('automatic mTLS');
  expect(() => meshConfigFields('[]')).toThrow('mapping');
  expect(meshConfigFields('{}' + ' '.repeat(262142))).toBeDefined();
  expect(() => meshConfigFields('{}' + ' '.repeat(262143))).toThrow('256 KiB');
  expect(() => meshConfigFields('{} #' + 'é'.repeat(131071))).toThrow('256 KiB');
  expect(() => injectorFields('secret-sentinel-invalid')).toThrow('Invalid configuration JSON');
  expect(() => injectorFields('{"global":{"proxy":{"clusterDomain":"../bad"}}}')).toThrow(
    'DNS suffix'
  );
});
it('does not use prototype-shaped YAML fields as reported mesh settings', () => {
  const value = meshConfigFields(
    '__proto__:\n  rootNamespace: unexpected\ntrustDomain: cluster.local'
  );
  expect(value.rootNamespace).toBeUndefined();
  expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'rootNamespace')).toBe(false);
});
it('retains tag ambiguity, conflicting labels, ambient labels and incomplete discovery', () => {
  const blue = controlPlaneObservation(controller);
  const green = { ...blue, uid: 'green', name: 'istiod-green', revision: 'green' };
  const namespaces = [
    { name: 'bookinfo', labels: { 'istio.io/rev': 'canary' } },
    { name: 'conflict', labels: { 'istio.io/rev': 'blue', 'istio-injection': 'enabled' } },
    { name: 'ambient', labels: { 'istio.io/dataplane-mode': 'ambient' } },
    { name: 'unknown', labels: { 'istio-injection': 'unexpected' } },
  ];
  const tags = [
    { name: 'tag-a', tag: 'canary', revision: 'blue' },
    { name: 'tag-b', tag: 'canary', revision: 'green' },
  ];
  const rows = namespaceAssociations(namespaces, [blue, green], tags, false);
  expect(rows[0].controllers).toHaveLength(2);
  expect(rows[0].complete).toBe(false);
  expect(rows.map(row => row.mode)).toEqual(['revision', 'conflicting', 'ambient', 'unknown']);
  expect(rows[1].controllers).toEqual([]);
});
it('validates namespace/tag labels without treating absent namespace injection as nonmembership', () => {
  expect(namespaceObservation({ metadata: { name: 'bookinfo' } })).toEqual({
    name: 'bookinfo',
    labels: {},
  });
  expect(() =>
    revisionTag({ metadata: { name: 'bad', labels: { 'istio.io/rev': 'blue' } } })
  ).toThrow('missing');
  expect(revisionTag({ metadata: { name: 'empty', labels: { 'istio.io/tag': '' } } })).toEqual({
    name: 'empty',
    tag: '',
    revision: '',
  });
  expect(
    revisionTag({
      metadata: { name: 'tag', labels: { 'istio.io/tag': 'default', 'istio.io/rev': 'blue' } },
    })
  ).toEqual({ name: 'tag', tag: 'default', revision: 'blue' });
});

it('retains the first captured tag per revision and does not union later aliases or raw revisions', () => {
  const blue = controlPlaneObservation(controller);
  const tags = [
    { name: 'first', tag: 'stable', revision: 'blue' },
    { name: 'later', tag: 'canary', revision: 'blue' },
  ];
  const chosen = selectedRevisionTags(tags);
  expect(chosen.selected.get('blue')).toBe(tags[0]);
  expect(chosen.ignored).toEqual([tags[1]]);
  const rows = namespaceAssociations(
    ['blue', 'stable', 'canary'].map(revision => ({
      name: revision,
      labels: { 'istio.io/rev': revision },
    })),
    [blue],
    tags,
    true
  );
  expect(rows.map(row => row.controllers.length)).toEqual([0, 1, 0]);
  expect(selectedRevisionTags([...tags].reverse()).selected.get('blue')).toBe(tags[1]);
  expect(
    namespaceAssociations(
      [{ name: 'raw', labels: { 'istio.io/rev': 'blue' } }],
      [blue],
      [{ name: 'empty', tag: '', revision: 'blue' }],
      true
    )[0].controllers
  ).toEqual([]);
});
it('preserves raw missing controller revisions and applies an explicit empty-revision tag', () => {
  const input = { ...controller, metadata: { ...controller.metadata, labels: { app: 'istiod' } } };
  const plane = controlPlaneObservation(input);
  expect(plane.revision).toBe('');
  expect(revisionConfigMapName('istio', plane.revision)).toBe('istio');
  const namespace = { name: 'ambient', labels: { 'istio.io/dataplane-mode': 'ambient' } };
  expect(namespaceAssociations([namespace], [plane], [], true)[0].controllers).toEqual([]);
  expect(
    namespaceAssociations(
      [namespace],
      [plane],
      [{ name: 'default-tag', tag: 'default', revision: '' }],
      true
    )[0].controllers
  ).toEqual([plane]);
});

it('projects local precedence, explicit false and sorted alias union without applying runtime defaults', () => {
  const shared = meshConfigFields(
    'rootNamespace: shared-system\ntrustDomain: shared.example\nenableAutoMtls: true\ntrustDomainAliases: [z.example, shared.example]\ndiscoverySelectors: [{matchLabels: {mesh: enabled}}]'
  );
  const local = meshConfigFields(
    'rootNamespace: local-system\ntrustDomain: local.example\nenableAutoMtls: false\ntrustDomainAliases: [a.example, z.example]'
  );
  const before = JSON.stringify([shared, local]);
  expect(mergeMeshFields(local, shared)).toMatchObject({
    rootNamespace: 'local-system',
    trustDomain: 'local.example',
    enableAutoMtls: false,
    trustDomainAliases: ['a.example', 'shared.example', 'z.example'],
    hasDiscoverySelectors: true,
  });
  expect(JSON.stringify([shared, local])).toBe(before);
  const unset = meshConfigFields(
    'rootNamespace: ""\ntrustDomain: null\nenableAutoMtls: null\ndiscoverySelectors: []'
  );
  expect(mergeMeshFields(unset, shared)).toMatchObject({
    rootNamespace: 'shared-system',
    trustDomain: 'shared.example',
    enableAutoMtls: true,
    hasDiscoverySelectors: true,
  });
  expect(meshConfigFields('').rootNamespace).toBeUndefined();
});

it('projects local/shared export defaults without silently applying defaults to inventory', () => {
  const shared = meshConfigFields(
    'defaultDestinationRuleExportTo: ["."]\ndefaultServiceExportTo: ["shared"]'
  );
  const local = meshConfigFields(
    'defaultDestinationRuleExportTo: ["*"]\ndefaultVirtualServiceExportTo: ["preview"]'
  );
  expect(mergeMeshFields(local, shared)).toMatchObject({
    defaultDestinationRuleExportTo: ['*'],
    defaultServiceExportTo: ['shared'],
    defaultVirtualServiceExportTo: ['preview'],
  });
  expect(
    mergeMeshFields(meshConfigFields('defaultDestinationRuleExportTo: []'), shared)
      .defaultDestinationRuleExportTo
  ).toEqual(['.']);
  expect(meshConfigFields('{}').defaultDestinationRuleExportTo).toBeUndefined();
  expect(() => meshConfigFields('defaultServiceExportTo: not-a-list')).toThrow(
    'defaultServiceExportTo'
  );
  expect(() => meshConfigFields('defaultDestinationRuleExportTo: [3]')).toThrow(
    'defaultDestinationRuleExportTo'
  );
});
