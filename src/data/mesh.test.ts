import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { clusterScope } from '../core/scope';
import { loadMeshSnapshot, namespaceMeshConfiguration } from './mesh';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));
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
    expect(options).toMatchObject({ cluster: 'alpha', signal });
    expect(options?.method).toBeUndefined();
    expect(String(path)).not.toContain('/secrets/');
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
