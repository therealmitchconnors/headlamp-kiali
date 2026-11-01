import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { clusterScope } from '../core/scope';
import { loadMeshSnapshot, localManagedNamespaceScope, namespaceMeshConfiguration } from './mesh';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));

describe('captured mounted mesh configuration', () => {
  const mountedController = () => ({
    ...structuredClone(controller),
    kind: 'Deployment',
    apiVersion: 'apps/v1',
    metadata: { ...controller.metadata, resourceVersion: 'cp-10' },
    spec: {
      ...controller.spec,
      template: {
        spec: {
          containers: [
            {
              name: 'discovery',
              image: 'example.test/pilot:v1',
              args: ['discovery', '--meshConfig=/custom/mesh.yaml'],
              env: [
                { name: 'CLUSTER_ID', value: 'logical' },
                { name: 'SHARED_MESH_CONFIG', value: 'shared' },
              ],
              volumeMounts: [{ name: 'config', mountPath: '/custom' }],
            },
          ],
          volumes: [
            {
              name: 'config',
              configMap: {
                name: 'mounted',
                items: [{ key: 'custom-mesh', path: 'mesh.yaml' }],
              },
            },
          ],
        },
      },
    },
  });
  function serve(path: string, deployment = mountedController()): unknown {
    const url = new URL(path, 'http://example.test');
    if (url.pathname === '/api/v1/namespaces')
      return list('Namespace', 'v1', [
        { metadata: { name: 'istio-system', uid: 'ns-system' } },
        { metadata: { name: 'bookinfo', uid: 'ns', labels: { 'istio.io/rev': 'blue' } } },
      ]);
    if (url.pathname === '/apis/apps/v1/namespaces/istio-system/deployments/istiod-blue')
      return deployment;
    const name = url.pathname.split('/').pop()!;
    if (name === 'mounted' || name === 'shared')
      return {
        kind: 'ConfigMap',
        apiVersion: 'v1',
        metadata: {
          name,
          namespace: 'istio-system',
          uid: `${name}-uid`,
          resourceVersion: `${name}-10`,
        },
        data:
          name === 'mounted'
            ? {
                'custom-mesh':
                  'rootNamespace: mounted-root\nenableAutoMtls: false\ntrustDomainAliases: [local]',
              }
            : {
                mesh: 'rootNamespace: shared-root\ntrustDomain: shared.test\ntrustDomainAliases: [shared]',
              },
      };
    return response(path, [deployment]);
  }
  const load = () => loadMeshSnapshot(clusterScope('alpha'), new AbortController().signal);
  beforeEach(() => {
    vi.mocked(ApiProxy.request).mockImplementation(async path => serve(String(path)));
  });
  it('replaces the standard source, merges shared fields, and carries verified source provenance to consumers', async () => {
    const snapshot = await load();
    const plane = snapshot.controlPlanes[0];
    expect(plane.mesh.name).toBe('mounted');
    expect(plane.effective).toMatchObject({
      status: 'ready',
      value: {
        rootNamespace: 'mounted-root',
        trustDomain: 'shared.test',
        enableAutoMtls: false,
        trustDomainAliases: ['local', 'shared'],
      },
      sources: {
        local: {
          kind: 'mounted',
          cluster: 'alpha',
          name: 'mounted',
          key: 'custom-mesh',
          path: '/custom/mesh.yaml',
          uid: 'mounted-uid',
          resourceVersion: 'mounted-10',
        },
        shared: { name: 'shared', key: 'mesh', status: 'ready' },
      },
    });
    const configuration = namespaceMeshConfiguration(snapshot, 'bookinfo');
    expect(configuration).toMatchObject({
      status: 'ready',
      root: { namespace: 'mounted-root', basis: 'configured' },
      sources: { local: { name: 'mounted' } },
    });
    expect(localManagedNamespaceScope(snapshot, 'logical').configurationSources[0]).toMatchObject({
      sources: { local: { name: 'mounted' } },
    });
    expect(ApiProxy.request).toHaveBeenCalledTimes(9);
    for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
      expect(String(path)).not.toMatch(/\/configmaps\/istio-blue$|\/secrets\//);
      expect(options?.cluster).toBe('alpha');
      expect(options?.method).toBeUndefined();
    }
    if (configuration.status !== 'ready' || plane.effective?.status !== 'ready') throw new Error();
    configuration.fields.trustDomainAliases?.push('changed');
    expect(plane.effective.value.trustDomainAliases).toEqual(['local', 'shared']);
  });
  it('keeps separate keys when mounted and shared configuration use the same ConfigMap', async () => {
    const deployment = mountedController();
    deployment.spec.template.spec.volumes[0].configMap.name = 'shared';
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      const result = serve(String(path), deployment);
      if (String(path).endsWith('/configmaps/shared'))
        Object.assign(result as object, {
          data: { mesh: 'trustDomain: shared.test', 'custom-mesh': 'rootNamespace: mounted-root' },
        });
      return result;
    });
    expect((await load()).controlPlanes[0].effective).toMatchObject({
      status: 'ready',
      value: { rootNamespace: 'mounted-root', trustDomain: 'shared.test' },
      sources: { local: { key: 'custom-mesh' }, shared: { key: 'mesh' } },
    });
  });
  it('retains standard-source equivalence while verifying a declared mount to the standard mesh key', async () => {
    const deployment = mountedController();
    deployment.spec.template.spec.volumes[0].configMap = {
      name: 'istio-blue',
      items: [{ key: 'mesh', path: 'mesh.yaml' }],
    };
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      if (String(path).endsWith('/configmaps/istio-blue'))
        return {
          kind: 'ConfigMap',
          apiVersion: 'v1',
          metadata: {
            name: 'istio-blue',
            namespace: 'istio-system',
            uid: 'standard-uid',
            resourceVersion: 'standard-10',
          },
          data: { mesh: 'rootNamespace: standard-root' },
        };
      return serve(String(path), deployment);
    });
    expect((await load()).controlPlanes[0].effective).toMatchObject({
      status: 'ready',
      value: { rootNamespace: 'standard-root' },
      sources: { local: { kind: 'standard', name: 'istio-blue', path: '/custom/mesh.yaml' } },
    });
    expect(
      vi
        .mocked(ApiProxy.request)
        .mock.calls.filter(([path]) => String(path).endsWith('/configmaps/istio-blue'))
    ).toHaveLength(2);
  });
  it('retains confirmed optional shared-map absence without losing the mounted local fields', async () => {
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      if (String(path).endsWith('/configmaps/shared')) throw { status: 404 };
      return serve(String(path));
    });
    expect((await load()).controlPlanes[0].effective).toMatchObject({
      status: 'ready',
      sharedAbsent: true,
      value: { rootNamespace: 'mounted-root', enableAutoMtls: false },
      sources: { shared: { name: 'shared', status: 'not-found' } },
    });
  });
  it.each([
    'missing-key',
    'malformed',
    'missing-uid',
    'missing-version',
    'wrong-identity',
    'denied',
    'missing',
  ])('blocks %s mounted sources without reading or reviving the standard source', async failure => {
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      if (String(path).endsWith('/configmaps/mounted')) {
        if (failure === 'denied') throw { status: 403 };
        if (failure === 'missing') throw { status: 404 };
        const result = serve(String(path)) as {
          metadata: Record<string, string>;
          data: Record<string, string>;
        };
        if (failure === 'missing-key') result.data = { mesh: 'rootNamespace: wrong' };
        if (failure === 'malformed') result.data['custom-mesh'] = 'rootNamespace: [';
        if (failure === 'missing-uid') delete result.metadata.uid;
        if (failure === 'missing-version') delete result.metadata.resourceVersion;
        if (failure === 'wrong-identity') result.metadata.name = 'other';
        return result;
      }
      return serve(String(path));
    });
    const snapshot = await load();
    expect(snapshot.controlPlanes[0].effective?.status).toBe('unavailable');
    expect(namespaceMeshConfiguration(snapshot, 'bookinfo').status).toBe('unavailable');
    expect(() => localManagedNamespaceScope(snapshot, 'logical')).toThrow();
    expect(
      vi
        .mocked(ApiProxy.request)
        .mock.calls.some(([path]) => String(path).endsWith('/configmaps/istio-blue'))
    ).toBe(false);
  });
  it.each(['mounted', 'shared'])('rejects stale %s source versions during capture', async name => {
    let reads = 0;
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      const result = serve(String(path));
      if (String(path).endsWith(`/configmaps/${name}`) && ++reads > 1)
        (result as { metadata: { resourceVersion: string } }).metadata.resourceVersion = 'changed';
      return result;
    });
    expect((await load()).controlPlanes[0].effective).toMatchObject({
      status: 'unavailable',
      message: expect.stringContaining('changed'),
    });
  });
  it.each(
    ['mounted', 'shared'].flatMap(name =>
      [
        { shape: 'absent', data: undefined },
        { shape: 'null', data: null },
        { shape: 'array', data: [] },
        { shape: 'scalar', data: 'not-a-map' },
      ].map(test => ({ name, ...test }))
    )
  )('keeps required $name mesh fields unavailable with $shape data', async ({ name, data }) => {
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      const result = serve(String(path)) as { data?: unknown };
      if (String(path).endsWith(`/configmaps/${name}`)) {
        if (data === undefined) delete result.data;
        else result.data = data;
      }
      return result;
    });
    const snapshot = await load();
    const plane = snapshot.controlPlanes[0];
    expect(name === 'mounted' ? plane.mesh.status : plane.shared?.status).toBe('error');
    expect(plane.effective?.status).toBe('unavailable');
    expect(namespaceMeshConfiguration(snapshot, 'bookinfo').status).toBe('unavailable');
    expect(
      vi
        .mocked(ApiProxy.request)
        .mock.calls.some(([path]) => String(path).endsWith('/configmaps/istio-blue'))
    ).toBe(false);
  });
  it('does not treat a newly appearing optional shared map as the earlier confirmed absence', async () => {
    let reads = 0;
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      if (String(path).endsWith('/configmaps/shared') && ++reads === 1) throw { status: 404 };
      return serve(String(path));
    });
    expect((await load()).controlPlanes[0].effective?.status).toBe('unavailable');
  });
  it.each([
    'controller-changed',
    'controller-unversioned',
    'shared-denied',
    'incomplete-controllers',
  ])(
    'rejects %s evidence rather than authorizing namespace or absence conclusions',
    async failure => {
      const deployment = mountedController();
      if (failure === 'controller-unversioned') deployment.metadata.resourceVersion = '';
      vi.mocked(ApiProxy.request).mockImplementation(async path => {
        if (failure === 'shared-denied' && String(path).endsWith('/configmaps/shared'))
          throw { status: 403 };
        const result = serve(String(path), deployment);
        if (failure === 'controller-changed' && String(path).endsWith('/deployments/istiod-blue'))
          deployment.metadata.resourceVersion = 'changed';
        if (
          failure === 'incomplete-controllers' &&
          String(path).startsWith('/apis/apps/v1/deployments?')
        )
          (result as { metadata: object }).metadata = {
            resourceVersion: '10',
            continue: 'repeated',
          };
        return result;
      });
      const snapshot = await load();
      expect(snapshot.controlPlanes[0].effective?.status).toBe('unavailable');
      expect(namespaceMeshConfiguration(snapshot, 'bookinfo').status).toBe('unavailable');
    }
  );
  it('does not reuse a previous successful snapshot after a source becomes denied', async () => {
    expect((await load()).controlPlanes[0].effective?.status).toBe('ready');
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      if (String(path).endsWith('/configmaps/mounted')) throw { status: 403 };
      return serve(String(path));
    });
    expect((await load()).controlPlanes[0].effective?.status).toBe('unavailable');
  });
  it.each([
    ...[undefined, '', '{}', 'null', 'networks: {}'].map(value => ({
      value,
      data: value === undefined ? {} : { topology: value },
    })),
    { value: undefined, data: undefined },
    { value: undefined, data: null },
  ])(
    'checks the mounted networks acceptance dependency without projecting topology: $value',
    async ({ value, data }) => {
      const deployment = mountedController();
      deployment.spec.template.spec.containers[0].args.push(
        '--networksConfigFile=/networks/map.yaml'
      );
      deployment.spec.template.spec.containers[0].volumeMounts.push({
        name: 'networks',
        mountPath: '/networks',
      });
      deployment.spec.template.spec.volumes.push({
        name: 'networks',
        configMap: { name: 'networks', items: [{ key: 'topology', path: 'map.yaml' }] },
      });
      vi.mocked(ApiProxy.request).mockImplementation(async path => {
        if (String(path).endsWith('/configmaps/networks'))
          return {
            kind: 'ConfigMap',
            apiVersion: 'v1',
            metadata: {
              name: 'networks',
              namespace: 'istio-system',
              uid: 'net-uid',
              resourceVersion: 'net-10',
            },
            ...(data === undefined ? {} : { data }),
          };
        return serve(String(path), deployment);
      });
      expect((await load()).controlPlanes[0].effective).toMatchObject({
        status: 'ready',
        sources: {
          networks: {
            name: 'networks',
            key: 'topology',
            path: '/networks/map.yaml',
            content: value === undefined ? 'absent-key' : 'empty',
          },
        },
      });
      expect(
        vi
          .mocked(ApiProxy.request)
          .mock.calls.filter(([path]) => String(path).endsWith('/configmaps/networks'))
      ).toHaveLength(2);
    }
  );
  it.each(['denied', 'missing', 'malformed', 'nonempty', 'stale'])(
    'does not accept a mounted file with %s networks dependency',
    async failure => {
      const deployment = mountedController();
      deployment.spec.template.spec.containers[0].args.push(
        '--networksConfigFile=/custom/network.yaml'
      );
      deployment.spec.template.spec.volumes[0].configMap.items.push({
        key: 'topology',
        path: 'network.yaml',
      });
      let reads = 0;
      vi.mocked(ApiProxy.request).mockImplementation(async path => {
        if (String(path).endsWith('/configmaps/mounted')) {
          reads++;
          if (failure === 'denied' && reads > 1) throw { status: 403 };
          if (failure === 'missing' && reads > 1) throw { status: 404 };
          const result = serve(String(path), deployment) as {
            metadata: { resourceVersion: string };
            data: Record<string, string>;
          };
          result.data.topology =
            failure === 'malformed'
              ? 'networks: ['
              : failure === 'nonempty'
              ? 'networks: {east: {}}'
              : '{}';
          if (failure === 'stale' && reads > 2) result.metadata.resourceVersion = 'changed';
          return result;
        }
        return serve(String(path), deployment);
      });
      const snapshot = await load();
      expect(snapshot.controlPlanes[0].effective?.status).toBe('unavailable');
      expect(namespaceMeshConfiguration(snapshot, 'bookinfo').status).toBe('unavailable');
    }
  );
  it.each(['meshNetworks: [', 'networks: {east: {}}'])(
    'does not ignore shared-source networks parsing/coverage dependencies: %s',
    async meshNetworks => {
      vi.mocked(ApiProxy.request).mockImplementation(async path => {
        const result = serve(String(path));
        if (String(path).endsWith('/configmaps/shared'))
          (result as { data: Record<string, string> }).data.meshNetworks = meshNetworks;
        return result;
      });
      expect((await load()).controlPlanes[0].effective?.status).toBe('unavailable');
    }
  );
  it('cancels mounted-source verification within the existing whole-capture deadline', async () => {
    vi.useFakeTimers();
    try {
      let reads = 0;
      vi.mocked(ApiProxy.request).mockImplementation(async path => {
        if (String(path).endsWith('/configmaps/mounted') && ++reads > 1)
          return new Promise(() => {});
        return serve(String(path));
      });
      const caller = new AbortController();
      const pending = loadMeshSnapshot(clusterScope('alpha'), caller.signal);
      const failure = expect(pending).rejects.toThrow('Mesh discovery exceeded 15 seconds');
      await vi.advanceTimersByTimeAsync(15000);
      await failure;
      expect(caller.signal.aborted).toBe(false);
      expect(
        vi.mocked(ApiProxy.request).mock.calls.every(([, options]) => options?.signal?.aborted)
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

const controller = {
  metadata: {
    name: 'istiod-blue',
    namespace: 'istio-system',
    uid: 'cp',
    labels: { app: 'istiod', 'istio.io/rev': 'blue' },
  },
  spec: {
    replicas: 2,
    template: { spec: { containers: [{ name: 'discovery', image: 'example.test/pilot:v1' }] } },
  },
  status: { replicas: 2, availableReplicas: 2 },
};
const list = (kind: string, apiVersion: string, items: unknown[]) => ({
  kind: `${kind}List`,
  apiVersion,
  metadata: { resourceVersion: '10' },
  items,
});
function response(path: string, controllers = [controller]): unknown {
  const url = new URL(path, 'http://example.test');
  if (url.pathname === '/api/v1/namespaces')
    return list('Namespace', 'v1', [
      { metadata: { name: 'bookinfo', uid: 'ns', labels: { 'istio.io/rev': 'blue' } } },
    ]);
  if (url.pathname === '/apis/apps/v1/deployments') {
    expect(url.searchParams.get('labelSelector')).toBe('app=istiod');
    expect(url.searchParams.get('limit')).toBe('50');
    return list('Deployment', 'apps/v1', controllers);
  }
  if (url.pathname.includes('/mutatingwebhookconfigurations')) {
    expect(url.searchParams.get('labelSelector')).toBe('istio.io/tag');
    return list('MutatingWebhookConfiguration', 'admissionregistration.k8s.io/v1', []);
  }
  const name = url.pathname.split('/').pop()!;
  return {
    kind: 'ConfigMap',
    apiVersion: 'v1',
    metadata: { name, namespace: 'istio-system' },
    data: name.includes('sidecar-injector')
      ? { values: '{"global":{"network":"east","proxy":{"clusterDomain":"cluster.local"}}}' }
      : { mesh: 'rootNamespace: istio-system\ntrustDomain: trust.example' },
  };
}
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
  vi.mocked(ApiProxy.request).mockImplementation(async path => response(String(path)));
});
it('uses explicit scope, standard revision sources and no Secret or write requests', async () => {
  const signal = new AbortController().signal;
  const result = await loadMeshSnapshot(clusterScope('alpha'), signal);
  expect(result.controllers.complete).toBe(true);
  expect(result.controlPlanes[0].mesh).toMatchObject({
    status: 'ready',
    name: 'istio-blue',
    value: { rootNamespace: 'istio-system', trustDomain: 'trust.example' },
  });
  expect(result.controlPlanes[0].injector).toMatchObject({
    status: 'ready',
    value: { serviceIdentityDomain: 'svc.cluster.local' },
  });
  expect(ApiProxy.request).toHaveBeenCalledTimes(5);
  for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
    expect(options?.cluster).toBe('alpha');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.signal?.aborted).toBe(true);
    expect(options?.method).toBeUndefined();
    expect(String(path)).not.toContain('/secrets/');
  }
  expect(signal.aborted).toBe(false);
});
it('uses only first-container configuration references without reading a later discovery container source', async () => {
  const deployment = structuredClone(controller);
  Object.assign(deployment.spec.template.spec, {
    containers: [
      {
        name: 'first',
        image: 'first:image',
        env: [{ name: 'SHARED_MESH_CONFIG', value: 'first-shared' }],
      },
      {
        name: 'discovery',
        image: 'second:image',
        env: [{ name: 'SHARED_MESH_CONFIG', value: 'ignored-shared' }],
      },
    ],
  });
  vi.mocked(ApiProxy.request).mockImplementation(async path =>
    response(String(path), [deployment])
  );
  const result = await loadMeshSnapshot(clusterScope('alpha'), new AbortController().signal);
  expect(result.controlPlanes[0].controller.configurationContainer).toBe('first');
  expect(result.controlPlanes[0].shared).toMatchObject({ status: 'ready', name: 'first-shared' });
  expect(
    vi.mocked(ApiProxy.request).mock.calls.some(([path]) => String(path).includes('/first-shared'))
  ).toBe(true);
  expect(
    vi
      .mocked(ApiProxy.request)
      .mock.calls.some(([path]) => String(path).includes('/ignored-shared'))
  ).toBe(false);
});
it('uses final cluster/shared assignments and never requests a superseded shared source', async () => {
  const deployment = structuredClone(controller);
  Object.assign(deployment.spec.template.spec.containers[0], {
    env: [
      { name: 'CLUSTER_ID', value: 'old-cluster' },
      { name: 'CLUSTER_ID', value: 'last-cluster' },
      { name: 'SHARED_MESH_CONFIG', value: 'old-shared' },
      { name: 'SHARED_MESH_CONFIG', value: 'last-shared' },
    ],
  });
  vi.mocked(ApiProxy.request).mockImplementation(async path =>
    response(String(path), [deployment])
  );
  const result = await loadMeshSnapshot(clusterScope('alpha'), new AbortController().signal);
  expect(result.controlPlanes[0].controller.clusterId).toBe('last-cluster');
  expect(result.controlPlanes[0].shared).toMatchObject({ status: 'ready', name: 'last-shared' });
  expect(
    vi.mocked(ApiProxy.request).mock.calls.some(([path]) => String(path).includes('/last-shared'))
  ).toBe(true);
  expect(
    vi.mocked(ApiProxy.request).mock.calls.some(([path]) => String(path).includes('/old-shared'))
  ).toBe(false);
});
it.each(['true', '1', 'TRUE'])(
  'does not erase EXTERNAL_ISTIOD=%s with a later false declaration',
  async value => {
    const deployment = structuredClone(controller);
    Object.assign(deployment.spec.template.spec.containers[0], {
      env: [
        { name: 'EXTERNAL_ISTIOD', value },
        { name: 'EXTERNAL_ISTIOD', value: 'false' },
        { name: 'SHARED_MESH_CONFIG', value: 'not-read' },
      ],
    });
    vi.mocked(ApiProxy.request).mockImplementation(async path =>
      response(String(path), [deployment])
    );
    const result = await loadMeshSnapshot(clusterScope('alpha'), new AbortController().signal);
    expect(result.controlPlanes[0].controller.managesExternal).toBe(value === 'true' ? true : null);
    expect(result.controlPlanes[0].effective?.status).toBe('unavailable');
    expect(namespaceMeshConfiguration(result, 'bookinfo').status).toBe('unavailable');
    expect(
      vi.mocked(ApiProxy.request).mock.calls.some(([path]) => String(path).includes('/not-read'))
    ).toBe(false);
  }
);
it('requires complete versioned sources and all resolved configurations before projecting local membership', async () => {
  const deployment = structuredClone(controller);
  Object.assign(deployment.spec.template.spec.containers[0], {
    env: [{ name: 'CLUSTER_ID', value: 'logical' }],
  });
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    if (String(path).startsWith('/api/v1/namespaces?'))
      return list('Namespace', 'v1', [
        { metadata: { name: 'bookinfo', uid: 'ns', labels: { 'istio.io/rev': 'blue' } } },
        { metadata: { name: 'istio-system', uid: 'control-ns', labels: {} } },
      ]);
    return response(String(path), [deployment]);
  });
  const snapshot = await loadMeshSnapshot(clusterScope('alpha'), new AbortController().signal);
  const projected = localManagedNamespaceScope(snapshot, 'logical');
  expect(projected.cluster).toBe('alpha');
  expect(projected.membership.map(item => item.namespace)).toEqual(['bookinfo', 'istio-system']);
  expect(() => localManagedNamespaceScope(snapshot, undefined)).toThrow('explicit logical');
  for (const key of ['namespaces', 'controllers', 'tags'] as const) {
    const incomplete = structuredClone(snapshot);
    incomplete[key].complete = false;
    expect(() => localManagedNamespaceScope(incomplete, 'logical')).toThrow('Complete versioned');
  }
  snapshot.controlPlanes[0].effective = { status: 'unavailable', message: 'Blocked' };
  expect(() => localManagedNamespaceScope(snapshot, 'logical')).toThrow('resolved configuration');
});
it('captures its cluster before awaiting discovery and retains one whole-read deadline', async () => {
  const scope = { cluster: 'alpha' };
  const pending = loadMeshSnapshot(scope, new AbortController().signal);
  scope.cluster = 'beta';
  const result = await pending;
  expect(result.cluster).toBe('alpha');
  expect(
    vi.mocked(ApiProxy.request).mock.calls.every(([, options]) => options?.cluster === 'alpha')
  ).toBe(true);
  vi.useFakeTimers();
  try {
    vi.mocked(ApiProxy.request)
      .mockReset()
      .mockImplementation(() => new Promise(() => {}));
    const caller = new AbortController();
    const waiting = loadMeshSnapshot(clusterScope('alpha'), caller.signal);
    const failure = expect(waiting).rejects.toThrow('Mesh discovery exceeded 15 seconds');
    await vi.advanceTimersByTimeAsync(15000);
    await failure;
    expect(ApiProxy.request).toHaveBeenCalledTimes(3);
    expect(
      vi.mocked(ApiProxy.request).mock.calls.every(([, options]) => options?.signal?.aborted)
    ).toBe(true);
    expect(caller.signal.aborted).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
it('resolves only unambiguous reported namespace-to-controller configuration', async () => {
  const mesh = await loadMeshSnapshot(clusterScope('alpha'), new AbortController().signal);
  expect(namespaceMeshConfiguration(mesh, 'bookinfo')).toMatchObject({
    status: 'ready',
    controller: 'istio-system/istiod-blue',
    fields: { rootNamespace: 'istio-system' },
  });
  expect(namespaceMeshConfiguration(mesh, 'missing').status).toBe('unavailable');
  expect(
    namespaceMeshConfiguration({ ...mesh, tags: { ...mesh.tags, complete: false } }, 'bookinfo')
      .status
  ).toBe('unavailable');
  expect(
    namespaceMeshConfiguration(
      { ...mesh, controlPlanes: [...mesh.controlPlanes, mesh.controlPlanes[0]] },
      'bookinfo'
    ).status
  ).toBe('unavailable');
  const plane = mesh.controlPlanes[0];
  if (plane.effective?.status !== 'ready') throw new Error('Expected resolved fixture');
  plane.effective.value.hasDiscoverySelectors = true;
  expect(namespaceMeshConfiguration(mesh, 'bookinfo')).toMatchObject({ status: 'unavailable' });
  plane.effective.value.discoverySelectors = [{ matchLabels: { 'istio.io/rev': 'blue' } }];
  expect(namespaceMeshConfiguration(mesh, 'bookinfo')).toMatchObject({
    status: 'ready',
    discovery: 'selector',
  });
  plane.effective.value.discoverySelectors = [{ matchLabels: { 'istio.io/rev': 'other' } }];
  expect(namespaceMeshConfiguration(mesh, 'bookinfo')).toMatchObject({
    status: 'unavailable',
    message: expect.stringContaining('excluded'),
  });
  plane.effective.value.discoverySelectors = [
    { matchExpressions: [{ key: 'app', operator: 'In', values: [] }] },
  ];
  expect(namespaceMeshConfiguration(mesh, 'bookinfo')).toMatchObject({
    status: 'unavailable',
    message: expect.stringContaining('require values'),
  });
});
it('does not resolve Maistra membership through coincident Istiod revision labels', async () => {
  const mesh = await loadMeshSnapshot(clusterScope('alpha'), new AbortController().signal);
  mesh.namespaces.items[0].labels = {
    'maistra.io/member-of': 'mesh-other',
    'istio.io/rev': 'blue',
  };
  expect(namespaceMeshConfiguration(mesh, 'bookinfo')).toMatchObject({
    status: 'unavailable',
    message: expect.stringContaining('Maistra membership'),
  });
  mesh.namespaces.items[0].labels = {
    ...mesh.namespaces.items[0].labels,
    'maistra.io/ignore-namespace': 'false',
  };
  expect(namespaceMeshConfiguration(mesh, 'bookinfo').status).toBe('ready');
  mesh.namespaces.items.push({
    name: 'istio-system',
    labels: { 'maistra.io/member-of': 'mesh-other', 'istio.io/rev': 'blue' },
  });
  expect(namespaceMeshConfiguration(mesh, 'istio-system')).toMatchObject({
    status: 'ready',
    discovery: 'implicit',
  });
});
it('resolves an ambient default only through its captured selected tag and rejects malformed labels', async () => {
  const mesh = await loadMeshSnapshot(clusterScope('alpha'), new AbortController().signal);
  mesh.namespaces.items[0].labels = { 'istio.io/dataplane-mode': 'ambient' };
  mesh.tags.items.push({ name: 'tag-default', tag: 'default', revision: 'blue' });
  expect(namespaceMeshConfiguration(mesh, 'bookinfo').status).toBe('ready');
  mesh.namespaces.items[0].labels = { 'istio.io/rev': 'bad value' };
  expect(namespaceMeshConfiguration(mesh, 'bookinfo')).toMatchObject({
    status: 'unavailable',
    message: expect.stringContaining('bounded Kubernetes label values'),
  });
});
it('does not resolve ignored tag aliases or the replaced raw revision', async () => {
  const mesh = await loadMeshSnapshot(clusterScope('alpha'), new AbortController().signal);
  mesh.tags.items = [
    { name: 'first', tag: 'stable', revision: 'blue' },
    { name: 'later', tag: 'canary', revision: 'blue' },
  ];
  expect(namespaceMeshConfiguration(mesh, 'bookinfo').status).toBe('unavailable');
  mesh.namespaces.items[0].labels = { 'istio.io/rev': 'stable' };
  expect(namespaceMeshConfiguration(mesh, 'bookinfo').status).toBe('ready');
  mesh.namespaces.items[0].labels = { 'istio.io/rev': 'canary' };
  expect(namespaceMeshConfiguration(mesh, 'bookinfo').status).toBe('unavailable');
  mesh.tags.items.reverse();
  expect(namespaceMeshConfiguration(mesh, 'bookinfo').status).toBe('ready');
});
it('keeps own/root namespace exceptions without assigning unrelated unlabelled namespaces', async () => {
  const mesh = await loadMeshSnapshot(clusterScope('alpha'), new AbortController().signal);
  const plane = mesh.controlPlanes[0];
  if (plane.effective?.status !== 'ready') throw new Error('Expected resolved fixture');
  plane.effective.value.discoverySelectors = [{ matchLabels: { team: 'missing' } }];
  plane.effective.value.hasDiscoverySelectors = true;
  plane.effective.value.rootNamespace = 'root-system';
  mesh.namespaces.items.push(
    ...['istio-system', 'root-system', 'unlabelled'].map(name => ({ name, labels: {} }))
  );
  expect(namespaceMeshConfiguration(mesh, 'istio-system')).toMatchObject({
    status: 'ready',
    discovery: 'implicit',
  });
  expect(namespaceMeshConfiguration(mesh, 'root-system')).toMatchObject({
    status: 'ready',
    discovery: 'implicit',
  });
  expect(namespaceMeshConfiguration(mesh, 'unlabelled').status).toBe('unavailable');
});
it('keeps failed tag/config access separate from successful controller discovery', async () => {
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    if (
      String(path).includes('mutatingwebhookconfigurations') ||
      String(path).includes('sidecar-injector')
    )
      throw { status: 403, message: 'Denied' };
    return response(String(path));
  });
  const result = await loadMeshSnapshot(clusterScope('alpha'), new AbortController().signal);
  expect(result.tags.complete).toBe(false);
  expect(result.tags.error?.kind).toBe('forbidden');
  expect(result.controllers.complete).toBe(true);
  expect(result.controlPlanes[0].mesh.status).toBe('ready');
  expect(result.controlPlanes[0].injector).toMatchObject({
    status: 'error',
    error: { kind: 'forbidden' },
  });
});
it('deduplicates shared ConfigMap reads and explicitly limits enrichment after 20 controllers', async () => {
  const controllers = Array.from({ length: 21 }, (_, i) => ({
    ...controller,
    metadata: {
      ...controller.metadata,
      uid: `cp-${i}`,
      name: `istiod-${String(i).padStart(2, '0')}`,
    },
  }));
  vi.mocked(ApiProxy.request).mockImplementation(async path => response(String(path), controllers));
  const result = await loadMeshSnapshot(clusterScope('alpha'), new AbortController().signal);
  expect(result.controlPlanes).toHaveLength(21);
  expect(result.controlPlanes[19].mesh.status).toBe('ready');
  expect(result.controlPlanes[20].mesh.status).toBe('limited');
  expect(
    vi.mocked(ApiProxy.request).mock.calls.filter(([path]) => String(path).includes('/configmaps/'))
  ).toHaveLength(2);
});
it('returns parse errors without leaking arbitrary ConfigMap data and sends nothing after abort', async () => {
  vi.mocked(ApiProxy.request).mockImplementation(async path =>
    String(path).endsWith('/istio-blue')
      ? {
          kind: 'ConfigMap',
          apiVersion: 'v1',
          metadata: { namespace: 'istio-system', name: 'istio-blue' },
          data: { mesh: '!bad secret-sentinel' },
        }
      : response(String(path))
  );
  const result = await loadMeshSnapshot(clusterScope('alpha'), new AbortController().signal);
  expect(result.controlPlanes[0].mesh).toMatchObject({
    status: 'error',
    error: { kind: 'invalid-response' },
  });
  expect(JSON.stringify(result.controlPlanes[0].mesh)).not.toContain('secret-sentinel');
  vi.mocked(ApiProxy.request).mockClear();
  const controller = new AbortController();
  controller.abort();
  await expect(loadMeshSnapshot(clusterScope('alpha'), controller.signal)).rejects.toThrow();
  expect(ApiProxy.request).not.toHaveBeenCalled();
});

it('keeps configuration reads at or below three concurrent requests', async () => {
  const controllers = Array.from({ length: 4 }, (_, i) => ({
    ...controller,
    metadata: {
      ...controller.metadata,
      name: `istiod-${i}`,
      uid: `cp-${i}`,
      labels: { app: 'istiod', 'istio.io/rev': `revision-${i}` },
    },
  }));
  let active = 0;
  let peak = 0;
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    if (String(path).includes('/configmaps/')) {
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
    }
    return response(String(path), controllers);
  });
  const result = await loadMeshSnapshot(clusterScope('alpha'), new AbortController().signal);
  expect(
    result.controlPlanes.every(
      plane => plane.mesh.status === 'ready' && plane.injector.status === 'ready'
    )
  ).toBe(true);
  expect(peak).toBe(3);
  expect(ApiProxy.request).toHaveBeenCalledTimes(11);
});

it.each(['ready', 'absent', 'denied', 'external'])(
  'resolves shared configuration as %s without guessing an external cluster',
  async mode => {
    const configured = {
      ...controller,
      spec: {
        ...controller.spec,
        template: {
          spec: {
            containers: [
              {
                ...controller.spec.template.spec.containers[0],
                env: [
                  { name: 'SHARED_MESH_CONFIG', value: 'shared-config' },
                  { name: 'EXTERNAL_ISTIOD', value: mode === 'external' ? 'true' : 'false' },
                ],
              },
            ],
          },
        },
      },
    };
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      if (String(path).endsWith('/shared-config')) {
        if (mode === 'absent' || mode === 'denied')
          throw { status: mode === 'absent' ? 404 : 403, message: mode };
        return {
          kind: 'ConfigMap',
          apiVersion: 'v1',
          metadata: { namespace: 'istio-system', name: 'shared-config' },
          data: {
            mesh: 'trustDomain: shared.example\ntrustDomainAliases: [shared.example]\nenableAutoMtls: false',
          },
        };
      }
      return response(String(path), [configured]);
    });
    const result = await loadMeshSnapshot(clusterScope('alpha'), new AbortController().signal);
    const effective = result.controlPlanes[0].effective;
    if (mode === 'ready')
      expect(effective).toMatchObject({
        status: 'ready',
        sharedAbsent: false,
        value: {
          rootNamespace: 'istio-system',
          trustDomain: 'trust.example',
          trustDomainAliases: ['shared.example'],
          enableAutoMtls: false,
        },
      });
    else if (mode === 'absent')
      expect(effective).toMatchObject({ status: 'ready', sharedAbsent: true });
    else expect(effective?.status).toBe('unavailable');
    if (mode === 'external')
      expect(
        vi
          .mocked(ApiProxy.request)
          .mock.calls.some(([path]) => String(path).endsWith('/shared-config'))
      ).toBe(false);
  }
);
