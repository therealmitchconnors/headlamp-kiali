import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { clusterScope } from '../core/scope';
import { loadMeshSnapshot, namespaceMeshConfiguration } from './mesh';
import { loadValidationSnapshot } from './validation';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
vi.mock('./mesh', () => ({ loadMeshSnapshot: vi.fn(), namespaceMeshConfiguration: vi.fn() }));
const spec = {
  hosts: ['api.example.test'],
  ports: [{ name: 'http', number: 80, protocol: 'HTTP' }],
};
const resource = (name: string, namespace: string) => ({
  metadata: { name, namespace, uid: `${namespace}-${name}` },
  spec,
});
const envelope = (kind: string, items: unknown[], apiVersion = 'networking.istio.io/v1') => ({
  kind: `${kind}List`,
  apiVersion,
  metadata: { resourceVersion: '1' },
  items,
});
let deny = false;
let malformed = false;
let active = 0;
let maximum = 0;
beforeEach(() => {
  deny = false;
  malformed = false;
  active = 0;
  maximum = 0;
  vi.mocked(loadMeshSnapshot).mockReset();
  vi.mocked(namespaceMeshConfiguration)
    .mockReset()
    .mockReturnValue({
      status: 'ready',
      controller: 'istiod',
      fields: { hasDiscoverySelectors: false, defaultServiceExportTo: ['*'] },
    });
  vi.mocked(ApiProxy.request)
    .mockReset()
    .mockImplementation(async path => {
      active++;
      maximum = Math.max(maximum, active);
      try {
        await Promise.resolve();
        const uri = String(path);
        if (uri === '/apis/networking.istio.io')
          return {
            name: 'networking.istio.io',
            versions: [{ groupVersion: 'networking.istio.io/v1' }],
          };
        if (uri === '/apis/networking.istio.io/v1')
          return {
            groupVersion: 'networking.istio.io/v1',
            resources: [
              { name: 'serviceentries', kind: 'ServiceEntry', namespaced: true },
              { name: 'sidecars', kind: 'Sidecar', namespaced: true },
            ],
          };
        if (uri.startsWith('/api/v1/namespaces?'))
          return envelope(
            'Namespace',
            ['bookinfo', 'other'].map(name => ({ metadata: { name, uid: `ns-${name}` } })),
            'v1'
          );
        if (uri.startsWith('/apis/networking.istio.io/v1/sidecars?'))
          return envelope('Sidecar', []);
        if (uri.startsWith('/apis/networking.istio.io/v1/serviceentries?')) {
          if (deny) throw { status: 403, message: 'ServiceEntry list denied' };
          return envelope('ServiceEntry', [
            resource('selected', 'bookinfo'),
            { ...resource('peer', 'other'), ...(malformed ? { kind: 'DestinationRule' } : {}) },
          ]);
        }
        throw new Error(`Unexpected validation request: ${uri}`);
      } finally {
        active--;
      }
    });
});
it('reads cluster-scoped peer evidence with preserved UIDs, three-worker limits and per-source namespace mesh defaults', async () => {
  const signal = new AbortController().signal;
  const result = await loadValidationSnapshot(
    clusterScope('headlamp-alpha'),
    'ServiceEntry',
    'networking.istio.io',
    spec,
    null,
    signal,
    'bookinfo'
  );
  expect(result.context.serviceEntries?.complete).toBe(true);
  expect(
    result.context.serviceEntries?.items.map(record => [record.name, record.namespace, record.uid])
  ).toEqual([
    ['selected', 'bookinfo', 'bookinfo-selected'],
    ['peer', 'other', 'other-peer'],
  ]);
  expect(maximum).toBeLessThanOrEqual(3);
  expect(loadMeshSnapshot).toHaveBeenCalledTimes(1);
  expect(
    vi
      .mocked(namespaceMeshConfiguration)
      .mock.calls.map(call => call[1])
      .sort()
  ).toEqual(['bookinfo', 'other']);
  expect(result.context.namespaceMesh?.get('other')).toMatchObject({
    status: 'ready',
    fields: { defaultServiceExportTo: ['*'] },
  });
  for (const [, options, autoLogout] of vi.mocked(ApiProxy.request).mock.calls) {
    expect(options).toMatchObject({ cluster: 'headlamp-alpha', signal: expect.any(AbortSignal) });
    expect(autoLogout).toBe(false);
  }
});
it.each(['denied', 'malformed'])(
  'retains %s ServiceEntry evidence as incomplete rather than an empty success',
  async reason => {
    deny = reason === 'denied';
    malformed = reason === 'malformed';
    const result = await loadValidationSnapshot(
      clusterScope('alpha'),
      'ServiceEntry',
      'networking.istio.io',
      spec,
      null,
      new AbortController().signal,
      'bookinfo'
    );
    expect(result.context.serviceEntries?.complete).toBe(false);
    expect(result.sources.find(source => source.key === 'serviceEntries')?.error?.kind).toBe(
      deny ? 'forbidden' : 'invalid-response'
    );
    expect(loadMeshSnapshot).not.toHaveBeenCalled();
  }
);
it('does not request unneeded group evidence and stops cancelled reads', async () => {
  await loadValidationSnapshot(
    clusterScope('alpha'),
    'ServiceEntry',
    'networking.istio.io',
    {},
    null,
    new AbortController().signal,
    'bookinfo'
  );
  expect(ApiProxy.request).not.toHaveBeenCalled();
  const controller = new AbortController();
  controller.abort();
  await expect(
    loadValidationSnapshot(
      clusterScope('alpha'),
      'ServiceEntry',
      'networking.istio.io',
      spec,
      null,
      controller.signal,
      'bookinfo'
    )
  ).rejects.toThrow();
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
