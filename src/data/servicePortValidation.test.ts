import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { controlPlaneObservation } from '../core/mesh';
import { clusterScope } from '../core/scope';
import { loadMeshSnapshot, MeshSnapshot } from './mesh';
import { loadServicePortValidation } from './servicePortValidation';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));
vi.mock('./mesh', async importOriginal => ({
  ...(await importOriginal<typeof import('./mesh')>()),
  loadMeshSnapshot: vi.fn(),
}));
const target = { namespace: 'bookinfo', name: 'reviews', uid: 'svc' };
function mesh(): MeshSnapshot {
  const controller = controlPlaneObservation({
    kind: 'Deployment',
    apiVersion: 'apps/v1',
    metadata: {
      name: 'istiod',
      namespace: 'istio-system',
      uid: 'cp',
      labels: { app: 'istiod', 'istio.io/rev': 'blue' },
    },
    spec: {
      template: {
        spec: {
          containers: [
            {
              name: 'discovery',
              env: [{ name: 'CLUSTER_ID', value: 'logical' }],
            },
          ],
        },
      },
    },
  });
  const fields = { rootNamespace: 'root', hasDiscoverySelectors: false };
  return {
    cluster: 'alpha',
    namespaces: {
      complete: true,
      resourceVersion: '10',
      items: ['bookinfo', 'other', 'istio-system', 'root', 'unmanaged', 'kube-system'].map(
        name => ({
          name,
          labels: ['bookinfo', 'other'].includes(name) ? { 'istio.io/rev': 'blue' } : {},
        })
      ),
    },
    controllers: { complete: true, resourceVersion: '20', items: [controller] },
    tags: { complete: true, resourceVersion: '30', items: [] },
    controlPlanes: [
      {
        controller,
        mesh: { status: 'ready', name: 'istio-blue', value: fields },
        injector: { status: 'ready', name: 'injector', value: {} },
        effective: { status: 'ready', value: fields, sharedAbsent: true },
      },
    ],
  };
}
const service = () => ({
  kind: 'Service',
  apiVersion: 'v1',
  metadata: { ...target, uid: 'svc', resourceVersion: '1' },
  spec: { selector: { app: 'reviews' }, ports: [{ name: 'bad', port: 80 }] },
});
function list(
  kind: string,
  apiVersion: string,
  items: unknown[],
  continuation = '',
  resourceVersion = '1'
) {
  return {
    kind: `${kind}List`,
    apiVersion,
    items,
    metadata: { resourceVersion, continue: continuation },
  };
}
function pod(namespace: string, i = 0) {
  return {
    metadata: {
      name: `pod-${i}`,
      namespace,
      uid: `${namespace}-${i}`,
      resourceVersion: '1',
      labels: { app: 'reviews' },
    },
    spec: {},
  };
}
function deployment() {
  return {
    metadata: {
      name: 'first',
      namespace: 'unmanaged',
      uid: 'dep',
      resourceVersion: '2',
      labels: { app: 'reviews' },
    },
    spec: { template: { spec: { containers: [] } } },
  };
}
function response(path: string): unknown {
  const url = new URL(path, 'http://example.test');
  if (url.pathname.endsWith('/services/reviews')) return service();
  if (url.pathname === '/apis/apps/v1/deployments')
    return list('Deployment', 'apps/v1', [deployment()]);
  if (url.pathname.endsWith('/pods')) {
    const namespace = url.pathname.split('/')[4];
    return list('Pod', 'v1', namespace === 'other' ? [pod(namespace)] : []);
  }
  throw new Error(`Unexpected read ${path}`);
}
const load = (logicalName: string | undefined = 'logical', signal = new AbortController().signal) =>
  loadServicePortValidation(clusterScope('alpha'), target, logicalName, signal);
beforeEach(() => {
  vi.mocked(loadMeshSnapshot).mockReset().mockResolvedValue(mesh());
  vi.mocked(ApiProxy.request)
    .mockReset()
    .mockImplementation(async path => response(String(path)));
});

it('uses every declared namespace, cross-namespace Pods and unfiltered cluster Deployments with no writes', async () => {
  const data = await load();
  expect(data.disabled).toBe(false);
  if (data.disabled) throw new Error('Fixture unexpectedly disabled');
  expect(data.result).toMatchObject({
    inMesh: false,
    matchedPods: 1,
    deployment: { uid: 'dep', namespace: 'unmanaged' },
  });
  expect(data.result.findings.map(value => value.code)).toEqual(['KIA0701']);
  expect(data.sources.map(source => source.namespace).sort()).toEqual([
    'bookinfo',
    'istio-system',
    'other',
    'root',
  ]);
  expect(data.deploymentSource).toEqual({ resourceVersion: '1', count: 1 });
  expect(ApiProxy.request).toHaveBeenCalledTimes(7);
  expect(loadMeshSnapshot).toHaveBeenCalledTimes(1);
  for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
    expect(options?.cluster).toBe('alpha');
    expect(options?.method).toBeUndefined();
    expect(options?.signal?.aborted).toBe(true);
    expect(String(path)).not.toContain('labelSelector');
    expect(String(path)).not.toContain('/unmanaged/pods');
    expect(String(path)).not.toContain('/kube-system/pods');
  }
});
it('executes the real mesh reader and namespace projection before collecting the complete port inputs', async () => {
  const original = await vi.importActual<typeof import('./mesh')>('./mesh');
  vi.mocked(loadMeshSnapshot).mockImplementation(original.loadMeshSnapshot);
  const snapshot = mesh();
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    const url = new URL(String(path), 'http://example.test');
    if (url.pathname === '/api/v1/namespaces')
      return list(
        'Namespace',
        'v1',
        snapshot.namespaces.items.map(namespace => ({
          metadata: { name: namespace.name, uid: namespace.name, labels: namespace.labels },
        }))
      );
    if (url.pathname.endsWith('/mutatingwebhookconfigurations'))
      return list('MutatingWebhookConfiguration', 'admissionregistration.k8s.io/v1', []);
    if (url.pathname === '/apis/apps/v1/deployments' && url.searchParams.has('labelSelector'))
      return list('Deployment', 'apps/v1', [
        {
          metadata: {
            name: 'istiod',
            namespace: 'istio-system',
            uid: 'cp',
            labels: { app: 'istiod', 'istio.io/rev': 'blue' },
          },
          spec: {
            template: {
              spec: {
                containers: [
                  {
                    name: 'discovery',
                    env: [{ name: 'CLUSTER_ID', value: 'logical' }],
                  },
                ],
              },
            },
          },
        },
      ]);
    if (url.pathname.includes('/configmaps/')) {
      const name = url.pathname.split('/').pop();
      return {
        kind: 'ConfigMap',
        apiVersion: 'v1',
        metadata: { name, namespace: 'istio-system' },
        data: name?.includes('sidecar-injector')
          ? { values: '{"global":{}}' }
          : { mesh: 'rootNamespace: root' },
      };
    }
    return response(String(path));
  });
  const data = await load();
  if (data.disabled) throw new Error('Disabled fixture');
  expect(data.sources).toHaveLength(4);
  expect(data.result.findings.map(value => value.code)).toEqual(['KIA0701']);
  expect(
    vi
      .mocked(ApiProxy.request)
      .mock.calls.filter(([path]) => String(path).startsWith('/apis/apps/v1/deployments?'))
  ).toHaveLength(2);
});
it('captures the target and cluster before awaiting', async () => {
  const scope = { cluster: 'alpha' };
  const selected = { ...target };
  const promise = loadServicePortValidation(
    scope,
    selected,
    'logical',
    new AbortController().signal
  );
  scope.cluster = 'beta';
  selected.name = 'changed';
  const data = await promise;
  expect(data.service.name).toBe('reviews');
  expect(
    vi.mocked(ApiProxy.request).mock.calls.every(([, options]) => options?.cluster === 'alpha')
  ).toBe(true);
});
it.each(['namespaces', 'controllers', 'tags'] as const)(
  'never activates from incomplete or unversioned %s sources',
  async key => {
    for (const incomplete of [true, false]) {
      const value = mesh();
      if (incomplete) value[key].complete = false;
      else delete value[key].resourceVersion;
      vi.mocked(loadMeshSnapshot).mockResolvedValue(value);
      await expect(load()).rejects.toThrow('Complete versioned');
      expect(ApiProxy.request).toHaveBeenCalledTimes(incomplete ? 1 : 2);
    }
  }
);
it('unresolved mesh configuration, wrong mapping, missing logical identity and excluded namespace defer before workload reads', async () => {
  await expect(
    loadServicePortValidation(
      clusterScope('alpha'),
      target,
      undefined,
      new AbortController().signal
    )
  ).rejects.toThrow('explicit logical');
  for (const mode of ['configuration', 'mapping', 'namespace']) {
    const value = mesh();
    if (mode === 'configuration')
      value.controlPlanes[0].effective = { status: 'unavailable', message: 'Denied' };
    if (mode === 'mapping') value.controllers.items[0].clusterId = 'different';
    if (mode === 'namespace') value.namespaces.items[0].labels = {};
    vi.mocked(loadMeshSnapshot).mockResolvedValue(value);
    await expect(load()).rejects.toThrow();
  }
  expect(ApiProxy.request).toHaveBeenCalledTimes(4);
});
it('all-excluded Services perform only the selected GET, even without mesh settings', async () => {
  const selected = service();
  Object.assign(selected.metadata, { annotations: { 'kiali.io/ignore-validations': '' } });
  vi.mocked(ApiProxy.request).mockResolvedValue(selected);
  const data = await loadServicePortValidation(
    clusterScope('alpha'),
    target,
    undefined,
    new AbortController().signal
  );
  expect(data.disabled).toBe(true);
  expect(loadMeshSnapshot).not.toHaveBeenCalled();
  expect(ApiProxy.request).toHaveBeenCalledTimes(1);
});
it.each(['/api/v1/namespaces/other/pods', '/apis/apps/v1/deployments'])(
  'denial of %s fails the whole check, never a partial success',
  async denied => {
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      if (String(path).startsWith(denied)) throw { status: 403, message: 'Denied source' };
      return response(String(path));
    });
    await expect(load()).rejects.toThrow('Denied source');
    expect(
      vi
        .mocked(ApiProxy.request)
        .mock.calls.filter(([path]) => String(path).endsWith('/services/reviews'))
    ).toHaveLength(1);
  }
);
it('requires correctly scoped and versioned Pod and Deployment records even in typed lists', async () => {
  for (const mode of ['pod-namespace', 'pod-version', 'deployment-version', 'pod-kind']) {
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      const p = String(path);
      if (mode.startsWith('pod') && p.startsWith('/api/v1/namespaces/other/pods')) {
        const value = pod('other');
        if (mode === 'pod-namespace') value.metadata.namespace = 'bookinfo';
        if (mode === 'pod-version') value.metadata.resourceVersion = '';
        const item = mode === 'pod-kind' ? { ...value, kind: 'Service' } : value;
        return list('Pod', 'v1', [item]);
      }
      if (mode === 'deployment-version' && p.startsWith('/apis/apps/v1/deployments')) {
        const value = deployment();
        value.metadata.resourceVersion = '';
        return list('Deployment', 'apps/v1', [value]);
      }
      return response(p);
    });
    await expect(load()).rejects.toThrow();
  }
});
it.each(['uid', 'resourceVersion', 'spec', 'labels', 'annotations'])(
  'rejects selected Service %s changes during evidence reads',
  async field => {
    let reads = 0;
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      if (String(path).endsWith('/services/reviews')) {
        const selected = service();
        if (++reads > 1) {
          if (field === 'uid') selected.metadata.uid = 'replaced';
          if (field === 'resourceVersion') selected.metadata.resourceVersion = '2';
          if (field === 'spec') selected.spec.ports[0].port = 81;
          if (field === 'labels')
            Object.assign(selected.metadata, { labels: { kiali_wizard: '' } });
          if (field === 'annotations')
            Object.assign(selected.metadata, {
              annotations: { 'kiali.io/ignore-validations': '' },
            });
        }
        return selected;
      }
      return response(String(path));
    });
    await expect(load()).rejects.toThrow(field === 'uid' ? 'Linked Service UID' : 'changed');
  }
);
it('follows complete pagination without sorting cluster-wide Deployments', async () => {
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    const url = new URL(String(path), 'http://example.test');
    if (url.pathname === '/apis/apps/v1/deployments') {
      const value = deployment();
      if (url.searchParams.has('continue')) {
        value.metadata.uid = 'second';
        value.metadata.name = 'second';
        value.spec.template.spec.containers = [];
        return list('Deployment', 'apps/v1', [value]);
      }
      return list('Deployment', 'apps/v1', [value], 'next');
    }
    return response(String(path));
  });
  const data = await load();
  if (data.disabled) throw new Error('Disabled fixture');
  expect(data.deploymentSource.count).toBe(2);
  expect(data.result.deployment?.uid).toBe('dep');
});
it('four-page truncation, changed list version and repeated tokens never produce findings', async () => {
  for (const mode of ['truncated', 'version', 'token']) {
    let page = 0;
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      if (String(path).startsWith('/api/v1/namespaces/other/pods')) {
        page++;
        return list(
          'Pod',
          'v1',
          [pod('other', page)],
          mode === 'token' ? 'same' : `page${page}`,
          mode === 'version' ? String(page) : '1'
        );
      }
      return response(String(path));
    });
    await expect(load()).rejects.toThrow();
  }
});
it('enforces the whole 1000-Pod pool rather than a per-namespace approximation', async () => {
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    const url = new URL(String(path), 'http://example.test');
    if (url.pathname.endsWith('/pods')) {
      const namespace = url.pathname.split('/')[4];
      const page = Number(url.searchParams.get('continue') ?? 0);
      return list(
        'Pod',
        'v1',
        Array.from({ length: 250 }, (_, i) => pod(namespace, page * 250 + i)),
        page === 3 ? '' : String(page + 1)
      );
    }
    return response(String(path));
  });
  await expect(load()).rejects.toThrow('1000-Pod');
});
it('bounds Pod namespace concurrency to three and cancels pending sources', async () => {
  let active = 0;
  let peak = 0;
  const pending: (() => void)[] = [];
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    if (String(path).includes('/pods?')) {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>(resolve =>
        pending.push(() => {
          active--;
          resolve();
        })
      );
    }
    return response(String(path));
  });
  const caller = new AbortController();
  const promise = load('logical', caller.signal);
  const rejected = expect(promise).rejects.toThrow();
  await vi.waitFor(() => expect(pending.length).toBe(3));
  expect(peak).toBe(3);
  caller.abort();
  await rejected;
  for (const finish of pending) finish();
});
it('one fifteen-second deadline covers selected GET, discovery and all sources', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(loadMeshSnapshot).mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 10000));
      return mesh();
    });
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      if (String(path).includes('/pods?')) await new Promise(() => {});
      return response(String(path));
    });
    const caller = new AbortController();
    const promise = load('logical', caller.signal);
    const rejected = expect(promise).rejects.toThrow('Service port checks exceeded 15 seconds');
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    expect(caller.signal.aborted).toBe(false);
    expect(
      vi.mocked(ApiProxy.request).mock.calls.every(([, options]) => options?.signal?.aborted)
    ).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
