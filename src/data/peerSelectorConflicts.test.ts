import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { peerSelectorlessChecks } from '../core/peerSelectorConflicts';
import { clusterScope } from '../core/scope';
import { loadMeshSnapshot, namespaceMeshConfiguration } from './mesh';
import { loadValidationSnapshot } from './validation';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
vi.mock('./mesh', () => ({ loadMeshSnapshot: vi.fn(), namespaceMeshConfiguration: vi.fn() }));
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
  vi.mocked(loadMeshSnapshot).mockReset();
  vi.mocked(namespaceMeshConfiguration).mockReset();
});
it.each(['ready', 'denied', 'unknown-mesh', 'missing-kind', 'malformed-envelope'])(
  'collects selectorless-only context with %s provenance',
  async mode => {
    vi.mocked(loadMeshSnapshot).mockResolvedValue({
      cluster: 'alpha',
      namespaces: { complete: true, items: [] },
      controllers: { complete: true, items: [] },
      tags: { complete: true, items: [] },
      controlPlanes: [],
    });
    vi.mocked(namespaceMeshConfiguration).mockReturnValue(
      mode === 'unknown-mesh'
        ? { status: 'unavailable', message: 'Namespace controller unresolved' }
        : { status: 'ready', controller: 'istiod', fields: { hasDiscoverySelectors: false } }
    );
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      if (path === '/apis/security.istio.io')
        return { name: 'security.istio.io', versions: [{ groupVersion: 'security.istio.io/v1' }] };
      if (path === '/apis/security.istio.io/v1')
        return {
          groupVersion: 'security.istio.io/v1',
          resources:
            mode === 'missing-kind'
              ? []
              : [{ kind: 'PeerAuthentication', name: 'peerauthentications', namespaced: true }],
        };
      if (String(path).startsWith('/api/v1/namespaces?'))
        return {
          kind: 'NamespaceList',
          apiVersion: 'v1',
          metadata: { resourceVersion: '1' },
          items: [{ metadata: { name: 'bookinfo', uid: 'ns' } }],
        };
      if (String(path).includes('/peerauthentications?')) {
        if (mode === 'denied') throw { status: 403, message: 'Policies denied' };
        return {
          kind: mode === 'malformed-envelope' ? 'OtherList' : 'PeerAuthenticationList',
          apiVersion: 'security.istio.io/v1',
          metadata: { resourceVersion: '1' },
          items: ['selected', 'peer'].map(name => ({
            metadata: { name, namespace: 'bookinfo', uid: name },
            spec: { selector: {} },
          })),
        };
      }
      throw new Error(`Unexpected context read: ${path}`);
    });
    const spec = { selector: {} };
    const snapshot = await loadValidationSnapshot(
      clusterScope('alpha'),
      'PeerAuthentication',
      'security.istio.io',
      spec,
      null,
      new AbortController().signal,
      'bookinfo'
    );
    expect(snapshot.sources.map(source => source.key)).toEqual([
      'namespaces',
      'peerAuthentications',
    ]);
    const result = peerSelectorlessChecks(
      'PeerAuthentication',
      'security.istio.io',
      'bookinfo',
      spec,
      snapshot.context,
      { name: 'selected', uid: 'selected' }
    );
    expect(result.findings.map(f => f.code)).toEqual(mode === 'ready' ? ['KIA0002'] : []);
    expect(result.skipped).toHaveLength(mode === 'ready' ? 0 : 1);
    expect(loadMeshSnapshot).toHaveBeenCalledTimes(
      mode === 'ready' || mode === 'unknown-mesh' ? 1 : 0
    );
    for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
      expect(options).toMatchObject({ cluster: 'alpha' });
      expect(path).not.toMatch(/destinationrules|services|pods|secrets/);
    }
  }
);
