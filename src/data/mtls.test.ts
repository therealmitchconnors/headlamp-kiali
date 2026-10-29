import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { clusterScope } from '../core/scope';
import { loadMeshSnapshot, MeshSnapshot } from './mesh';
import { loadMtlsSnapshot } from './mtls';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
vi.mock('./mesh', () => ({ loadMeshSnapshot: vi.fn() }));
const query = { namespace: 'bookinfo', controllerNamespace: 'istio-system', controller: 'istiod' };
const controller = {
  name: 'istiod',
  namespace: 'istio-system',
  uid: 'cp',
  revision: 'default',
  replicas: null,
  stale: false,
  configurationWarnings: [],
  managesExternal: false,
  effectiveConfigBlocked: false,
};
function mesh(): MeshSnapshot {
  return {
    cluster: 'alpha',
    namespaces: { complete: true, items: [{ name: 'bookinfo', labels: {} }] },
    controllers: { complete: true, items: [controller] },
    tags: { complete: true, items: [] },
    controlPlanes: [
      {
        controller,
        mesh: {
          status: 'ready',
          name: 'istio',
          value: { rootNamespace: 'istio-system', hasDiscoverySelectors: false },
        },
        injector: {
          status: 'ready',
          name: 'istio-sidecar-injector',
          value: { serviceIdentityDomain: 'svc.cluster.local' },
        },
        effective: {
          status: 'ready',
          sharedAbsent: false,
          value: { rootNamespace: 'istio-system', hasDiscoverySelectors: false },
        },
      },
    ],
  };
}
function response(path: string): unknown {
  const url = new URL(path, 'http://example.test');
  for (const [group, kind, plural] of [
    ['security.istio.io', 'PeerAuthentication', 'peerauthentications'],
    ['networking.istio.io', 'DestinationRule', 'destinationrules'],
  ]) {
    if (url.pathname === `/apis/${group}`)
      return { name: group, versions: [{ groupVersion: `${group}/v1` }] };
    if (url.pathname === `/apis/${group}/v1`)
      return { groupVersion: `${group}/v1`, resources: [{ name: plural, kind, namespaced: true }] };
    if (url.pathname.endsWith(`/${plural}`))
      return {
        kind: `${kind}List`,
        apiVersion: `${group}/v1`,
        metadata: { resourceVersion: '1' },
        items: url.pathname.includes('/namespaces/istio-system/')
          ? [
              {
                metadata: { name: 'mesh-strict', namespace: 'istio-system', uid: 'pa' },
                spec: { mtls: { mode: 'STRICT' } },
              },
            ]
          : [],
      };
  }
  throw new Error(`Unexpected request ${path}`);
}
beforeEach(() => {
  vi.mocked(loadMeshSnapshot).mockReset().mockResolvedValue(mesh());
  vi.mocked(ApiProxy.request)
    .mockReset()
    .mockImplementation(async path => response(String(path)));
});
it('assesses scoped policies with explicit controller/root/domain provenance and documented auto-mTLS default', async () => {
  const signal = new AbortController().signal;
  const result = await loadMtlsSnapshot(clusterScope('alpha'), query, null, signal);
  expect(result.assessment?.status).toBe('UNSET_INHERITED_STRICT');
  expect(result).toMatchObject({
    rootNamespace: 'istio-system',
    identityDomain: 'svc.cluster.local',
    autoMtlsEnabled: true,
    autoMtlsDefaulted: true,
  });
  expect(
    vi
      .mocked(ApiProxy.request)
      .mock.calls.every(([, options]) => options?.cluster === 'alpha' && options?.signal === signal)
  ).toBe(true);
});
it('does not assess policies for excluded or malformed declared namespace discovery', async () => {
  for (const selectors of [
    [{ matchLabels: { team: 'other' } }],
    [{ matchExpressions: [{ key: 'team', operator: 'In', values: [] }] }],
  ]) {
    const snapshot = mesh();
    const plane = snapshot.controlPlanes[0];
    if (plane.effective?.status !== 'ready') throw new Error('Expected ready fixture');
    plane.effective.value.hasDiscoverySelectors = true;
    plane.effective.value.discoverySelectors = selectors;
    vi.mocked(loadMeshSnapshot).mockResolvedValue(snapshot);
    await expect(
      loadMtlsSnapshot(clusterScope('alpha'), query, null, new AbortController().signal)
    ).rejects.toThrow();
    expect(ApiProxy.request).not.toHaveBeenCalled();
  }
});

it('uses controller-namespace root fallback only after configuration is resolved', async () => {
  const snapshot = mesh();
  const plane = snapshot.controlPlanes[0];
  if (plane.effective?.status !== 'ready') throw new Error('Expected ready fixture');
  delete plane.effective.value.rootNamespace;
  vi.mocked(loadMeshSnapshot).mockResolvedValue(snapshot);
  const result = await loadMtlsSnapshot(
    clusterScope('alpha'),
    query,
    null,
    new AbortController().signal
  );
  expect(result.rootNamespace).toBe('istio-system');
  expect(result.rootNamespaceDefaulted).toBe(true);
  expect(result.assessment?.status).toBe('UNSET_INHERITED_STRICT');
  plane.effective = { status: 'unavailable', message: 'Configuration denied' };
  vi.mocked(ApiProxy.request).mockClear();
  await expect(
    loadMtlsSnapshot(clusterScope('alpha'), query, null, new AbortController().signal)
  ).rejects.toThrow('unresolved');
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
it('permits a configured namespace selector match while retaining policy/health distinctions', async () => {
  const snapshot = mesh();
  snapshot.namespaces.items[0].labels = { team: 'mesh' };
  const plane = snapshot.controlPlanes[0];
  if (plane.effective?.status !== 'ready') throw new Error('Expected ready fixture');
  plane.effective.value.hasDiscoverySelectors = true;
  plane.effective.value.discoverySelectors = [{ matchLabels: { team: 'mesh' } }];
  vi.mocked(loadMeshSnapshot).mockResolvedValue(snapshot);
  expect(
    (await loadMtlsSnapshot(clusterScope('alpha'), query, null, new AbortController().signal))
      .assessment?.status
  ).toBe('UNSET_INHERITED_STRICT');
});
it('does not turn denied or malformed policy reads into an enabled/default indicator', async () => {
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    if (String(path).includes('/destinationrules'))
      throw { status: 403, message: 'Denied DestinationRules' };
    return response(String(path));
  });
  const result = await loadMtlsSnapshot(
    clusterScope('alpha'),
    query,
    null,
    new AbortController().signal
  );
  expect(result.assessment).toBeUndefined();
  expect(result.reason).toContain('incomplete');
  expect(result.destinationRules.error?.kind).toBe('forbidden');
});
it('rejects unknown selector fields instead of broadening a policy to namespace-wide', async () => {
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    if (String(path).includes('/namespaces/bookinfo/peerauthentications'))
      return {
        kind: 'PeerAuthenticationList',
        apiVersion: 'security.istio.io/v1',
        metadata: { resourceVersion: '1' },
        items: [
          {
            metadata: { name: 'invalid-selector', namespace: 'bookinfo', uid: 'invalid' },
            spec: { selector: { matchExpressions: [] }, mtls: { mode: 'STRICT' } },
          },
        ],
      };
    return response(String(path));
  });
  const result = await loadMtlsSnapshot(
    clusterScope('alpha'),
    query,
    null,
    new AbortController().signal
  );
  expect(result.assessment).toBeUndefined();
  expect(result.peers.error?.kind).toBe('invalid-response');
});
it('refuses unresolved/ambient contexts, preserves explicit DNS overrides and honors cancellation', async () => {
  const ambient = mesh();
  ambient.namespaces.items[0].labels = { 'istio.io/dataplane-mode': 'ambient' };
  vi.mocked(loadMeshSnapshot).mockResolvedValueOnce(ambient);
  await expect(
    loadMtlsSnapshot(clusterScope('alpha'), query, null, new AbortController().signal)
  ).rejects.toThrow('Ambient');
  expect(ApiProxy.request).not.toHaveBeenCalled();
  const explicit = await loadMtlsSnapshot(
    clusterScope('alpha'),
    query,
    'svc.custom',
    new AbortController().signal
  );
  expect(explicit.identityDomain).toBe('svc.custom');
  const controller = new AbortController();
  controller.abort();
  await expect(
    loadMtlsSnapshot(clusterScope('alpha'), query, null, controller.signal)
  ).rejects.toThrow();
});
