import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { controlPlaneObservation } from '../core/mesh';
import { clusterScope } from '../core/scope';
import { captureGateway, loadScopedGatewayValidation } from './gatewayValidation';
import { loadMeshSnapshot, MeshSnapshot } from './mesh';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
vi.mock('./mesh', async importOriginal => ({
  ...(await importOriginal<typeof import('./mesh')>()),
  loadMeshSnapshot: vi.fn(),
}));
const cpObject = () => ({
  kind: 'Deployment',
  apiVersion: 'apps/v1',
  metadata: {
    name: 'istiod',
    namespace: 'istio-system',
    uid: 'cp',
    resourceVersion: '1',
    labels: { app: 'istiod', 'istio.io/rev': 'default' },
  },
  spec: {
    replicas: 1,
    template: {
      metadata: { labels: { app: 'istiod' } },
      spec: {
        containers: [{ name: 'first', env: [{ name: 'CLUSTER_ID', value: 'logical-alpha' }] }],
      },
    },
  },
  status: { replicas: 1, availableReplicas: 1 },
});
function meshSnapshot(): MeshSnapshot {
  const controller = controlPlaneObservation(cpObject());
  return {
    cluster: 'alpha',
    namespaces: {
      complete: true,
      resourceVersion: '1',
      items: [
        { name: 'istio-system', labels: {} },
        { name: 'bookinfo', labels: { 'istio-injection': 'enabled' } },
        { name: 'edge', labels: { 'istio-injection': 'enabled' } },
        { name: 'outside', labels: {} },
      ],
    },
    controllers: { complete: true, resourceVersion: '1', items: [controller] },
    tags: { complete: true, resourceVersion: '1', items: [] },
    controlPlanes: [
      {
        controller,
        mesh: { status: 'ready', name: 'istio', value: { hasDiscoverySelectors: false } },
        injector: { status: 'ready', name: 'istio-sidecar-injector', value: {} },
        effective: { status: 'ready', value: { hasDiscoverySelectors: false }, sharedAbsent: true },
      },
    ],
  };
}
function gateway(
  group = 'networking.istio.io',
  name = 'selected',
  namespace = 'bookinfo'
): {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    uid: string;
    resourceVersion: string;
    generation: number;
    labels: Record<string, string>;
    annotations: Record<string, string>;
  };
  spec: Record<string, unknown>;
  status: Record<string, unknown>;
} {
  return {
    apiVersion: `${group}/v1`,
    kind: 'Gateway',
    metadata: {
      name,
      namespace,
      uid: `${namespace}/${name}`,
      resourceVersion: '1',
      generation: 1,
      labels: {},
      annotations: {},
    },
    spec:
      group === 'networking.istio.io'
        ? {
            selector: { app: 'gateway' },
            servers: [
              {
                hosts: ['example.test'],
                port: { number: 80, protocol: 'HTTP', name: 'deliberately-unconventional' },
              },
            ],
          }
        : {
            gatewayClassName: 'istio',
            listeners: [{ name: 'http', hostname: 'example.test', protocol: 'HTTP', port: 80 }],
            addresses: [],
          },
    status: {},
  };
}
function deployment(name = 'gateway', namespace = 'edge') {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name,
      namespace,
      uid: `${namespace}/${name}`,
      resourceVersion: '1',
      labels: { app: 'metadata-only' },
    },
    spec: {
      template: {
        metadata: { labels: { app: 'gateway' } },
        spec: { containers: [{ name: 'gateway' }] },
      },
    },
  };
}
function list(kind: string, apiVersion: string, items: object[], resourceVersion = '1') {
  return { kind: `${kind}List`, apiVersion, metadata: { resourceVersion }, items };
}
const settings = { logicalName: 'logical-alpha' };
const run = (
  target: unknown = gateway(),
  configured = settings,
  signal = new AbortController().signal
) => loadScopedGatewayValidation(clusterScope('alpha'), target, configured, signal);
const collections = new Map<string, object[]>();
let selected: ReturnType<typeof gateway>;
let discoveredClass = 'istio';
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
  vi.mocked(loadMeshSnapshot).mockReset();
  vi.mocked(loadMeshSnapshot).mockResolvedValue(meshSnapshot());
  selected = gateway();
  discoveredClass = 'istio';
  collections.clear();
  collections.set('deployments', [cpObject(), deployment()]);
  for (const plural of [
    'replicasets',
    'statefulsets',
    'daemonsets',
    'pods',
    'workloadgroups',
    'workloadentries',
  ])
    collections.set(plural, []);
  vi.mocked(ApiProxy.request).mockImplementation(async rawPath => {
    const path = String(rawPath);
    const groups = ['networking.istio.io', 'gateway.networking.k8s.io'];
    for (const group of groups) {
      if (path === `/apis/${group}`)
        return { name: group, versions: [{ groupVersion: `${group}/v1` }] };
      if (path === `/apis/${group}/v1`)
        return {
          groupVersion: `${group}/v1`,
          resources: [
            { name: 'gateways', kind: 'Gateway', namespaced: true },
            { name: 'gatewayclasses', kind: 'GatewayClass', namespaced: false },
            { name: 'workloadgroups', kind: 'WorkloadGroup', namespaced: true },
            { name: 'workloadentries', kind: 'WorkloadEntry', namespaced: true },
          ],
        };
      if (path === `/apis/${group}/v1/gateways?limit=250`)
        return list('Gateway', `${group}/v1`, [selected, ...(collections.get('gateways') ?? [])]);
      if (
        path ===
        `/apis/${group}/v1/namespaces/${selected.metadata.namespace}/gateways/${selected.metadata.name}`
      )
        return selected;
      if (path === `/apis/${group}/v1/gatewayclasses?limit=250`)
        return list('GatewayClass', `${group}/v1`, [
          {
            metadata: { name: discoveredClass, uid: 'class', resourceVersion: '1' },
            spec: { controllerName: 'istio.io/gateway-controller' },
          },
        ]);
    }
    const plurals: Record<string, [string, string, string]> = {
      deployments: ['Deployment', 'apps/v1', '/apis/apps/v1'],
      replicasets: ['ReplicaSet', 'apps/v1', '/apis/apps/v1'],
      statefulsets: ['StatefulSet', 'apps/v1', '/apis/apps/v1'],
      daemonsets: ['DaemonSet', 'apps/v1', '/apis/apps/v1'],
      pods: ['Pod', 'v1', '/api/v1'],
      workloadgroups: ['WorkloadGroup', 'networking.istio.io/v1', '/apis/networking.istio.io/v1'],
      workloadentries: ['WorkloadEntry', 'networking.istio.io/v1', '/apis/networking.istio.io/v1'],
    };
    for (const [plural, [kind, apiVersion, prefix]] of Object.entries(plurals))
      if (path === `${prefix}/${plural}?limit=250`)
        return list(kind, apiVersion, collections.get(plural) ?? []);
    throw new Error(`Unexpected scoped Gateway request: ${path}`);
  });
});
afterEach(() => vi.useRealTimers());

it('captures complete declared scope and default workloads, using template labels and no dormant port rules', async () => {
  const result = await run();
  expect(result.result.findings).toEqual([]);
  expect(result.controller).toMatchObject({
    name: 'istio-system/istiod',
    scopeToNamespace: false,
    uid: 'cp',
    resourceVersion: '1',
  });
  expect(result.scope?.membership.map(item => item.namespace)).toEqual([
    'istio-system',
    'bookinfo',
    'edge',
  ]);
  expect(result.workloads.map(item => item.kind)).toEqual(['Deployment', 'Deployment']);
  const paths = vi.mocked(ApiProxy.request).mock.calls.map(([path]) => String(path));
  expect(paths.filter(path => path.includes('gateway.networking.k8s.io'))).toEqual([]);
  expect(paths.at(-1)).toBe('/apis/networking.istio.io/v1/namespaces/bookinfo/gateways/selected');
  for (const [, options] of vi.mocked(ApiProxy.request).mock.calls)
    expect(options).toMatchObject({ cluster: 'alpha', signal: expect.any(AbortSignal) });
});
it('emits KIA0302 only after complete empty matching-workload evidence', async () => {
  collections.set('deployments', [cpObject()]);
  expect((await run()).result.findings).toMatchObject([{ code: 'KIA0302', path: 'spec/selector' }]);
});
it('uses exact-true controller scope from the first container, including true then false accumulation', async () => {
  const cp = cpObject();
  cp.spec.template.spec.containers[0].env.push(
    { name: 'PILOT_SCOPE_GATEWAY_TO_NAMESPACE', value: 'true' },
    { name: 'PILOT_SCOPE_GATEWAY_TO_NAMESPACE', value: 'false' }
  );
  collections.set('deployments', [cp, deployment()]);
  const mesh = meshSnapshot();
  mesh.controllers.items[0] = controlPlaneObservation(cp);
  mesh.controlPlanes[0].controller = mesh.controllers.items[0];
  vi.mocked(loadMeshSnapshot).mockResolvedValue(mesh);
  const result = await run();
  expect(result.controller?.scopeToNamespace).toBe(true);
  expect(result.result.findings).toMatchObject([{ code: 'KIA0302' }]);
});
it('does not import workloads or conflicting Gateways outside declared membership', async () => {
  collections.set('deployments', [cpObject(), deployment('outside-gateway', 'outside')]);
  collections.set('gateways', [gateway('networking.istio.io', 'outside', 'outside')]);
  expect((await run()).result.findings.map(item => item.code)).toEqual(['KIA0302']);
});
it('retains literal host/port conflicts and class/group separation in complete declared scope', async () => {
  collections.set('gateways', [gateway('networking.istio.io', 'peer', 'edge')]);
  const result = await run();
  expect(result.result.findings.map(item => item.code)).toEqual(['KIA0301']);
  expect(result.result.findings[0].references).toMatchObject([
    { group: 'networking.istio.io', name: 'peer', namespace: 'edge' },
  ]);
});
it.each(['namespaces', 'controllers', 'tags'] as const)(
  'requires complete versioned %s scope sources',
  async key => {
    const mesh = meshSnapshot();
    mesh[key].complete = false;
    vi.mocked(loadMeshSnapshot).mockResolvedValue(mesh);
    await expect(run()).rejects.toThrow('Complete versioned');
    expect(ApiProxy.request).not.toHaveBeenCalled();
    mesh[key].complete = true;
    mesh[key].resourceVersion = undefined;
    await expect(run()).rejects.toThrow('Complete versioned');
  }
);
it.each(['unmapped', 'external', 'ambiguous', 'unresolved-scope', 'outside'])(
  'guards %s controller/scope evidence before collections',
  async mode => {
    const mesh = meshSnapshot();
    if (mode === 'unmapped') mesh.controllers.items[0].clusterId = 'different';
    if (mode === 'external') mesh.controllers.items[0].managesExternal = true;
    if (mode === 'unresolved-scope') mesh.controllers.items[0].scopeGatewayToNamespace = null;
    if (mode === 'outside') selected.metadata.namespace = 'outside';
    if (mode === 'ambiguous') {
      const second = { ...mesh.controllers.items[0], name: 'istiod-second', uid: 'second' };
      mesh.controllers.items.push(second);
      mesh.controlPlanes.push({ ...mesh.controlPlanes[0], controller: second });
    }
    vi.mocked(loadMeshSnapshot).mockResolvedValue(mesh);
    await expect(run(selected)).rejects.toThrow();
    expect(ApiProxy.request).not.toHaveBeenCalled();
  }
);
it.each([
  'deployments',
  'replicasets',
  'statefulsets',
  'daemonsets',
  'pods',
  'workloadgroups',
  'workloadentries',
  'gateways',
])('denied %s evidence cannot yield a partial finding', async plural => {
  const implementation = vi.mocked(ApiProxy.request).getMockImplementation()!;
  vi.mocked(ApiProxy.request).mockImplementation(async (path, ...args) => {
    if (String(path).endsWith(`/${plural}?limit=250`))
      throw { status: 403, message: `${plural} denied` };
    return implementation(path, ...args);
  });
  collections.set('deployments', [cpObject()]);
  await expect(run()).rejects.toThrow(/incomplete/);
});
it.each(['uid', 'version', 'spec', 'status', 'generation', 'annotations', 'labels'])(
  'discards a selected Gateway with changed %s during deferred reads',
  async field => {
    const original = structuredClone(selected);
    const implementation = vi.mocked(ApiProxy.request).getMockImplementation()!;
    vi.mocked(ApiProxy.request).mockImplementation(async (path, ...args) => {
      if (String(path).includes('/namespaces/bookinfo/gateways/selected')) {
        const changed = structuredClone(selected);
        if (field === 'uid') changed.metadata.uid = 'new';
        if (field === 'version') changed.metadata.resourceVersion = '2';
        if (field === 'spec') changed.spec = { ...changed.spec, selector: { app: 'changed' } };
        if (field === 'status') changed.status = { changed: true };
        if (field === 'generation') changed.metadata.generation = 2;
        if (field === 'annotations') changed.metadata.annotations = { changed: 'true' };
        if (field === 'labels') changed.metadata.labels = { changed: 'true' };
        return changed;
      }
      return implementation(path, ...args);
    });
    await expect(run(original)).rejects.toThrow('changed');
  }
);
it.each(['uid', 'version', 'environment'])('rejects stale controller %s evidence', async field => {
  const cp = cpObject();
  if (field === 'uid') cp.metadata.uid = 'new';
  if (field === 'version') cp.metadata.resourceVersion = '2';
  if (field === 'environment')
    cp.spec.template.spec.containers[0].env.push({
      name: 'PILOT_SCOPE_GATEWAY_TO_NAMESPACE',
      value: 'true',
    });
  collections.set('deployments', [cp, deployment()]);
  await expect(run()).rejects.toThrow('controller');
});
it.each(['missing-version', 'wrong-envelope', 'duplicate', 'malformed', 'truncated'])(
  'rejects %s list evidence',
  async mode => {
    const implementation = vi.mocked(ApiProxy.request).getMockImplementation()!;
    vi.mocked(ApiProxy.request).mockImplementation(async (path, ...args) => {
      if (String(path).startsWith('/apis/apps/v1/deployments?')) {
        const items: object[] = [cpObject()];
        if (mode === 'duplicate') items.push(cpObject());
        if (mode === 'malformed')
          items.push({
            metadata: { name: 'bad', namespace: 'bookinfo', uid: 'bad', resourceVersion: '1' },
            spec: { template: 'bad' },
          });
        const response = {
          kind: mode === 'wrong-envelope' ? 'PodList' : 'DeploymentList',
          apiVersion: 'apps/v1',
          metadata: {
            resourceVersion: mode === 'missing-version' ? '' : '1',
            continue: mode === 'truncated' ? `${String(path)}-next` : '',
          },
          items,
        };
        return response;
      }
      return implementation(path, ...args);
    });
    await expect(run()).rejects.toThrow('incomplete');
  }
);
it('continues complete pagination and normalizes omitted typed-list item kind/apiVersion', async () => {
  const implementation = vi.mocked(ApiProxy.request).getMockImplementation()!;
  vi.mocked(ApiProxy.request).mockImplementation(async (path, ...args) => {
    if (String(path) === '/apis/apps/v1/deployments?limit=250')
      return {
        ...list('Deployment', 'apps/v1', [cpObject()]),
        metadata: { resourceVersion: '1', continue: 'next' },
      };
    if (String(path) === '/apis/apps/v1/deployments?limit=250&continue=next') {
      const item = deployment();
      return list('Deployment', 'apps/v1', [{ metadata: item.metadata, spec: item.spec }]);
    }
    return implementation(path, ...args);
  });
  expect((await run()).result.findings).toEqual([]);
});
it('preserves first pooled VM entry label provenance across namespaces', async () => {
  collections.set('deployments', [cpObject()]);
  collections.set('workloadgroups', [
    {
      metadata: { name: 'vm', namespace: 'bookinfo', uid: 'vm', resourceVersion: '1' },
      spec: { metadata: { labels: { app: 'gateway' } } },
    },
  ]);
  collections.set('workloadentries', [
    {
      metadata: { name: 'entry', namespace: 'edge', uid: 'entry', resourceVersion: '1' },
      spec: { labels: { app: 'gateway', version: 'v1' } },
    },
  ]);
  const result = await run();
  expect(result.result.findings).toEqual([]);
  expect(result.workloads.find(item => item.kind === 'WorkloadGroup')?.entry?.namespace).toBe(
    'edge'
  );
});
it('keeps Gateway API collisions, current listener conditions and registry checks independent of Istio selector rules', async () => {
  selected = gateway('gateway.networking.k8s.io');
  selected.status = {
    listeners: [
      {
        name: 'http',
        conditions: [
          {
            type: 'Conflicted',
            status: 'True',
            reason: 'HostnameConflict',
            message: 'conflict',
            observedGeneration: 1,
          },
        ],
      },
    ],
  };
  collections.set('gateways', [gateway('gateway.networking.k8s.io', 'peer', 'edge')]);
  discoveredClass = 'other';
  const result = await run(selected);
  expect(result.result.findings.map(item => item.code).sort()).toEqual([
    'GWAPI',
    'KIA1501',
    'KIA1504',
  ]);
  expect(result.result.findings.find(item => item.code === 'GWAPI')?.path).toBe(
    'status/listeners[0]/conditions[0]/reason/HostnameConflict'
  );
  expect(result.workloads).toEqual([]);
  expect(result.controller).toBeUndefined();
  expect(ApiProxy.request).not.toHaveBeenCalledWith(
    expect.stringContaining('/deployments'),
    expect.anything(),
    expect.anything()
  );
});
it('keeps stale Gateway API controller conditions explicitly unevaluated', async () => {
  selected = gateway('gateway.networking.k8s.io');
  selected.status = {
    conditions: [
      {
        type: 'Accepted',
        status: 'False',
        reason: 'UnsupportedProtocol',
        message: 'unsupported',
        observedGeneration: 0,
      },
    ],
  };
  const result = await run(selected);
  expect(result.result.findings).toEqual([]);
  expect(result.result.skipped.join()).toContain('stale');
});
it('explicit class configuration avoids class discovery without asserting controller readiness', async () => {
  selected = gateway('gateway.networking.k8s.io');
  const result = await loadScopedGatewayValidation(
    clusterScope('alpha'),
    selected,
    {
      ...settings,
      gatewayClasses: { classes: [{ name: 'Istio', className: 'istio' }], selector: {} },
    },
    new AbortController().signal
  );
  expect(result.registry?.basis).toBe('configured');
  expect(
    vi.mocked(ApiProxy.request).mock.calls.some(([path]) => String(path).includes('gatewayclasses'))
  ).toBe(false);
});
it('captures caller settings/resource before awaits, and skips all-exclusions without reads', async () => {
  selected.metadata.annotations = { 'kiali.io/ignore-validations': '' };
  expect((await run(selected)).excluded).toBe(true);
  expect(ApiProxy.request).not.toHaveBeenCalled();
  expect(loadMeshSnapshot).not.toHaveBeenCalled();
  selected.metadata.annotations = { 'kiali.io/ignore-validations': 'KIA0302' };
  collections.set('deployments', [cpObject()]);
  expect((await run(selected)).result).toMatchObject({ findings: [], suppressed: 1 });
});
it('cancels pending reads and enforces one shared deadline without returning partial findings', async () => {
  vi.useFakeTimers();
  const implementation = vi.mocked(ApiProxy.request).getMockImplementation()!;
  let pendingSignal: AbortSignal | undefined;
  vi.mocked(ApiProxy.request).mockImplementation(async (path, options, ...args) => {
    if (String(path).includes('/deployments?')) {
      pendingSignal = options?.signal;
      return new Promise(() => {});
    }
    return implementation(path, options, ...args);
  });
  const pending = run();
  const checked = expect(pending).rejects.toThrow('15 seconds');
  await vi.advanceTimersByTimeAsync(15001);
  await checked;
  expect(pendingSignal?.aborted).toBe(true);
  const controller = new AbortController();
  const cancelled = run(selected, settings, controller.signal);
  const cancellation = expect(cancelled).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  await cancellation;
});
it('rejects invalid captures and unmapped names before any transport', async () => {
  await expect(run(selected, { logicalName: '' })).rejects.toThrow();
  expect(() => captureGateway({ ...selected, apiVersion: 'wrong/v1' })).toThrow('Unsupported');
  expect(() =>
    captureGateway({ ...selected, metadata: { ...selected.metadata, resourceVersion: '' } })
  ).toThrow();
  const controller = new AbortController();
  controller.abort();
  await expect(run(selected, settings, controller.signal)).rejects.toThrow();
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
it('rejects mesh evidence from another context before collection reads', async () => {
  vi.mocked(loadMeshSnapshot).mockResolvedValue({ ...meshSnapshot(), cluster: 'beta' });
  await expect(run()).rejects.toThrow('different cluster');
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
it('captures resource and mesh settings before deferred discovery', async () => {
  let finish: (mesh: MeshSnapshot) => void = () => {};
  const deferred = new Promise<MeshSnapshot>(resolve => {
    finish = resolve;
  });
  vi.mocked(loadMeshSnapshot).mockReturnValue(deferred);
  const mutableSettings = { logicalName: 'logical-alpha' };
  const capturedTarget = structuredClone(selected);
  const pending = run(capturedTarget, mutableSettings);
  mutableSettings.logicalName = 'other';
  capturedTarget.metadata.uid = 'changed-by-caller';
  capturedTarget.metadata.annotations['kiali.io/ignore-validations'] = '';
  finish(meshSnapshot());
  expect((await pending).target.uid).toBe(selected.metadata.uid);
});
it('bounds collection transport to three concurrent workers', async () => {
  const implementation = vi.mocked(ApiProxy.request).getMockImplementation()!;
  let active = 0;
  let peak = 0;
  vi.mocked(ApiProxy.request).mockImplementation(async (path, ...args) => {
    if (String(path).includes('?limit=')) {
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      const result = await implementation(path, ...args);
      active--;
      return result;
    }
    return implementation(path, ...args);
  });
  await run();
  expect(peak).toBe(3);
});
it.each(['denied', 'unversioned'])(
  'guards %s GatewayClass discovery without a success-shaped fallback',
  async mode => {
    selected = gateway('gateway.networking.k8s.io');
    const implementation = vi.mocked(ApiProxy.request).getMockImplementation()!;
    vi.mocked(ApiProxy.request).mockImplementation(async (path, ...args) => {
      if (String(path).includes('/gatewayclasses?')) {
        if (mode === 'denied') throw { status: 403, message: 'Class list denied' };
        return list('GatewayClass', 'gateway.networking.k8s.io/v1', [
          {
            metadata: { name: 'istio', uid: 'class', resourceVersion: '' },
            spec: { controllerName: 'istio.io/gateway-controller' },
          },
        ]);
      }
      return implementation(path, ...args);
    });
    await expect(run(selected)).rejects.toThrow('incomplete');
  }
);
it('guards every declared controller version, not only the selected Gateway controller', async () => {
  const mesh = meshSnapshot();
  const second = cpObject();
  second.metadata.name = 'istiod-blue';
  second.metadata.uid = 'cp-blue';
  second.metadata.labels['istio.io/rev'] = 'blue';
  const original = controlPlaneObservation(second);
  mesh.controllers.items.push(original);
  mesh.controlPlanes.push({ ...mesh.controlPlanes[0], controller: original });
  vi.mocked(loadMeshSnapshot).mockResolvedValue(mesh);
  second.metadata.resourceVersion = '2';
  collections.set('deployments', [cpObject(), second, deployment()]);
  await expect(run()).rejects.toThrow('controller');
});
it('does not normalize a legacy owner GVK into a modern typed workload', async () => {
  collections.set('pods', [
    {
      metadata: {
        name: 'legacy-owned',
        namespace: 'edge',
        uid: 'legacy-pod',
        resourceVersion: '1',
        ownerReferences: [
          {
            apiVersion: 'apps/v1beta1',
            kind: 'Deployment',
            name: 'gateway',
            uid: 'edge/gateway',
            controller: true,
          },
        ],
      },
      spec: { containers: [{ name: 'proxy' }] },
    },
  ]);
  await expect(run()).rejects.toThrow('owner API version is unsupported');
});
