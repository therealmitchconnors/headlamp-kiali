import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { referenceValidation } from '../core/referenceValidation';
import { clusterScope } from '../core/scope';
import { loadValidationSnapshot } from './validation';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
const spec = { http: [{ route: [{ destination: { host: 'reviews', subset: 'v1' } }] }] };
const namespace = {
  kind: 'Namespace',
  apiVersion: 'v1',
  metadata: { name: 'bookinfo', uid: 'namespace-uid' },
};
const list = (items: unknown[] = [namespace], continuation = '') => ({
  kind: 'NamespaceList',
  apiVersion: 'v1',
  metadata: { resourceVersion: '10', continue: continuation },
  items,
});
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});

it.each([false, true])(
  'reads only the Istio Gateway group with denial=%s and no DNS dependency',
  async denied => {
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      if (path === '/apis/networking.istio.io')
        return {
          name: 'networking.istio.io',
          versions: [{ groupVersion: 'networking.istio.io/v1' }],
        };
      if (path === '/apis/networking.istio.io/v1')
        return {
          groupVersion: 'networking.istio.io/v1',
          resources: [{ kind: 'Gateway', name: 'gateways', namespaced: true }],
        };
      if (String(path).startsWith('/apis/networking.istio.io/v1/gateways?')) {
        if (denied) throw { status: 403, message: 'Denied Istio gateways' };
        return {
          kind: 'GatewayList',
          apiVersion: 'networking.istio.io/v1',
          metadata: { resourceVersion: '1' },
          items: [{ metadata: { name: 'observed', namespace: 'bookinfo', uid: 'uid' }, spec: {} }],
        };
      }
      throw new Error(`Unexpected request ${path}`);
    });
    const result = await loadValidationSnapshot(
      clusterScope('alpha'),
      'Gateway',
      'networking.istio.io',
      { servers: [{ hosts: ['*'] }] },
      null,
      new AbortController().signal,
      'bookinfo'
    );
    expect(result.sources.map(source => source.key)).toEqual(['istioGateways']);
    expect(result.context.istioGateways?.complete).toBe(!denied);
    if (denied) expect(result.sources[0].error?.kind).toBe('forbidden');
    for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
      expect(path).toContain('/apis/networking.istio.io');
      expect(options).toMatchObject({ cluster: 'alpha' });
    }
  }
);

it('avoids unnecessary discovery and keeps local-only checks useful without a DNS setting', async () => {
  const result = await loadValidationSnapshot(
    clusterScope('alpha'),
    'VirtualService',
    'networking.istio.io',
    spec,
    null,
    new AbortController().signal
  );
  expect(result.sources).toEqual([]);
  expect(result.context.namespaces.complete).toBe(false);
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
it('reads bounded namespace evidence for ReferenceGrant on the explicit cluster', async () => {
  vi.mocked(ApiProxy.request).mockResolvedValue(list());
  const signal = new AbortController().signal;
  const result = await loadValidationSnapshot(
    clusterScope('alpha'),
    'ReferenceGrant',
    'gateway.networking.k8s.io',
    {},
    null,
    signal
  );
  expect(result.context.namespaces.complete).toBe(true);
  expect(result.context.namespaces.items.map(item => item.name)).toEqual(['bookinfo']);
  expect(ApiProxy.request).toHaveBeenCalledWith(
    '/api/v1/namespaces?limit=250',
    expect.objectContaining({ cluster: 'alpha', signal: expect.any(AbortSignal) }),
    false
  );
});

it('inherits omitted item type metadata only from a validated list envelope', async () => {
  vi.mocked(ApiProxy.request).mockResolvedValue(list([{ metadata: namespace.metadata }]));
  const result = await loadValidationSnapshot(
    clusterScope('alpha'),
    'ReferenceGrant',
    'gateway.networking.k8s.io',
    {},
    null,
    new AbortController().signal
  );
  expect(result.context.namespaces.complete).toBe(true);
  vi.mocked(ApiProxy.request).mockResolvedValue(list([{ ...namespace, kind: 'Service' }]));
  const wrong = await loadValidationSnapshot(
    clusterScope('alpha'),
    'ReferenceGrant',
    'gateway.networking.k8s.io',
    {},
    null,
    new AbortController().signal
  );
  expect(wrong.context.namespaces.complete).toBe(false);
  expect(wrong.sources[0].error?.kind).toBe('invalid-response');
});
it('keeps denied namespace reads incomplete, not an empty proven namespace universe', async () => {
  vi.mocked(ApiProxy.request).mockRejectedValue({ status: 403, message: 'Denied' });
  const result = await loadValidationSnapshot(
    clusterScope('alpha'),
    'ReferenceGrant',
    'gateway.networking.k8s.io',
    {},
    null,
    new AbortController().signal
  );
  expect(result.context.namespaces.complete).toBe(false);
  expect(result.sources[0].error?.kind).toBe('forbidden');
});
it.each(['repeated-token', 'changed-version', 'duplicate', 'malformed'])(
  'rejects %s pagination while retaining partial provenance',
  async reason => {
    vi.mocked(ApiProxy.request).mockResolvedValueOnce(list([namespace], 'next'));
    const second =
      reason === 'malformed'
        ? { ...list(), kind: 'WrongList' }
        : reason === 'changed-version'
        ? { ...list([]), metadata: { resourceVersion: 'different' } }
        : reason === 'duplicate'
        ? list([namespace])
        : list([], 'next');
    vi.mocked(ApiProxy.request).mockResolvedValueOnce(second);
    const result = await loadValidationSnapshot(
      clusterScope('alpha'),
      'ReferenceGrant',
      'gateway.networking.k8s.io',
      {},
      null,
      new AbortController().signal
    );
    expect(result.context.namespaces.complete).toBe(false);
    expect(result.sources[0].error?.kind).toBe('invalid-response');
    expect(result.context.namespaces.items).toHaveLength(1);
  }
);
it('enforces four-page bounds and cancellation', async () => {
  let page = 0;
  vi.mocked(ApiProxy.request).mockImplementation(async () => list([], `next-${page++}`));
  const result = await loadValidationSnapshot(
    clusterScope('alpha'),
    'ReferenceGrant',
    'gateway.networking.k8s.io',
    {},
    null,
    new AbortController().signal
  );
  expect(result.sources[0].limited).toBe(true);
  expect(ApiProxy.request).toHaveBeenCalledTimes(4);
  const controller = new AbortController();
  controller.abort();
  await expect(
    loadValidationSnapshot(
      clusterScope('alpha'),
      'ReferenceGrant',
      'gateway.networking.k8s.io',
      {},
      null,
      controller.signal
    )
  ).rejects.toThrow();
  expect(ApiProxy.request).toHaveBeenCalledTimes(4);
});
it('discovers each configuration kind and isolates a failed source from successful lists', async () => {
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    if (path === '/apis/networking.istio.io')
      return {
        name: 'networking.istio.io',
        versions: [{ groupVersion: 'networking.istio.io/v1' }],
      };
    if (path === '/apis/networking.istio.io/v1')
      return {
        groupVersion: 'networking.istio.io/v1',
        resources: [
          { name: 'destinationrules', kind: 'DestinationRule', namespaced: true },
          { name: 'sidecars', kind: 'Sidecar', namespaced: true },
        ],
      };
    if (String(path).includes('/sidecars')) throw { status: 403, message: 'Sidecar access denied' };
    if (String(path).includes('/destinationrules'))
      return {
        kind: 'DestinationRuleList',
        apiVersion: 'networking.istio.io/v1',
        metadata: { resourceVersion: '10' },
        items: [],
      };
    return list();
  });
  const result = await loadValidationSnapshot(
    clusterScope('alpha'),
    'VirtualService',
    'networking.istio.io',
    spec,
    'svc.cluster.local',
    new AbortController().signal
  );
  expect(result.context.namespaces.complete).toBe(true);
  expect(result.context.destinationRules.complete).toBe(true);
  expect(result.context.sidecars.complete).toBe(false);
  expect(result.sources.find(source => source.key === 'sidecars')?.error?.kind).toBe('forbidden');
});

it.each(['private', 'public', 'denied', 'virtual-only'])(
  'uses observed mesh root/export defaults and retains %s configuration evidence',
  async mode => {
    const observedNamespaces = ['bookinfo', 'preview', 'istio-system'].map(name => ({
      ...namespace,
      metadata: { name, uid: name, labels: { 'istio.io/rev': 'blue' } },
    }));
    const collection = (kind: string, apiVersion: string, items: unknown[]) => ({
      kind: `${kind}List`,
      apiVersion,
      metadata: { resourceVersion: '1' },
      items,
    });
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      const url = new URL(String(path), 'http://example.test');
      if (url.pathname === '/apis/networking.istio.io')
        return {
          name: 'networking.istio.io',
          versions: [{ groupVersion: 'networking.istio.io/v1' }],
        };
      if (url.pathname === '/apis/networking.istio.io/v1')
        return {
          groupVersion: 'networking.istio.io/v1',
          resources: [
            { name: 'destinationrules', kind: 'DestinationRule', namespaced: true },
            { name: 'sidecars', kind: 'Sidecar', namespaced: true },
            { name: 'serviceentries', kind: 'ServiceEntry', namespaced: true },
            { name: 'virtualservices', kind: 'VirtualService', namespaced: true },
          ],
        };
      if (url.pathname === '/api/v1/namespaces') return list(observedNamespaces);
      if (url.pathname === '/api/v1/services')
        return collection('Service', 'v1', [
          {
            metadata: {
              name: 'reviews',
              namespace: 'bookinfo',
              uid: 'svc',
              annotations: { 'networking.istio.io/exportTo': '*' },
            },
            spec: {},
          },
        ]);
      if (url.pathname.endsWith('/serviceentries'))
        return collection('ServiceEntry', 'networking.istio.io/v1', []);
      if (url.pathname.endsWith('/virtualservices'))
        return collection('VirtualService', 'networking.istio.io/v1', [
          {
            metadata: { name: 'selected', namespace: 'bookinfo', uid: 'selected-uid' },
            spec: input,
          },
          ...(mode === 'virtual-only'
            ? [
                {
                  metadata: { name: 'peer', namespace: 'preview', uid: 'peer-uid' },
                  spec: { hosts: ['different'] },
                },
              ]
            : []),
        ]);
      if (url.pathname.endsWith('/destinationrules'))
        return collection('DestinationRule', 'networking.istio.io/v1', [
          {
            metadata: { name: 'reviews', namespace: 'preview', uid: 'dr' },
            spec: { host: 'reviews.bookinfo', subsets: [{ name: 'v1' }] },
          },
        ]);
      if (url.pathname.endsWith('/sidecars'))
        return collection('Sidecar', 'networking.istio.io/v1', [
          {
            metadata: { name: 'root', namespace: 'istio-system', uid: 'sidecar' },
            spec: { egress: [{ hosts: ['*/*'] }] },
          },
        ]);
      if (url.pathname === '/apis/apps/v1/deployments')
        return collection('Deployment', 'apps/v1', [
          {
            metadata: {
              name: 'istiod-blue',
              namespace: 'istio-system',
              uid: 'cp',
              labels: { app: 'istiod', 'istio.io/rev': 'blue' },
            },
            spec: { replicas: 1, template: { spec: { containers: [{ name: 'discovery' }] } } },
            status: { replicas: 1, availableReplicas: 1 },
          },
        ]);
      if (url.pathname.endsWith('/mutatingwebhookconfigurations'))
        return collection('MutatingWebhookConfiguration', 'admissionregistration.k8s.io/v1', []);
      if (url.pathname.includes('/configmaps/')) {
        if (mode === 'denied') throw { status: 403, message: 'Mesh configuration denied' };
        const name = url.pathname.split('/').pop();
        return {
          kind: 'ConfigMap',
          apiVersion: 'v1',
          metadata: { name, namespace: 'istio-system' },
          data: name?.includes('sidecar-injector')
            ? { values: '{"global": {}}' }
            : {
                mesh: `rootNamespace: istio-system\ndefaultDestinationRuleExportTo: ["${
                  mode === 'public' ? '*' : '.'
                }"]`,
              },
        };
      }
      throw new Error(`Unexpected test request ${path}`);
    });
    const signal = new AbortController().signal;
    const input =
      mode === 'virtual-only' ? { hosts: ['reviews'] } : { ...spec, hosts: ['reviews'] };
    const result = await loadValidationSnapshot(
      clusterScope('alpha'),
      'VirtualService',
      'networking.istio.io',
      input,
      'svc.cluster.local',
      signal,
      'bookinfo'
    );
    expect(result.sources.every(source => source.complete)).toBe(true);
    if (mode === 'virtual-only')
      expect(result.sources.map(source => source.key)).toEqual([
        'namespaces',
        'virtualServices',
        'sidecars',
      ]);
    const checked = referenceValidation(
      'VirtualService',
      'networking.istio.io',
      'bookinfo',
      input,
      result.context,
      { name: 'selected', uid: 'selected-uid' }
    );
    if (mode === 'denied') {
      expect(result.context.namespaceMesh?.get('bookinfo')?.status).toBe('unavailable');
      expect(checked.findings).toEqual([]);
      expect(checked.skipped.length).toBeGreaterThan(0);
    } else {
      expect(result.context.namespaceMesh?.get('preview')?.status).toBe('ready');
      expect(checked.skipped).toEqual([]);
      expect(checked.findings.map(f => f.code)).toEqual(mode === 'private' ? ['KIA1107'] : []);
    }
    for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
      expect(options).toMatchObject({ cluster: 'alpha', signal: expect.any(AbortSignal) });
      expect(options?.method).toBeUndefined();
      expect(path).not.toContain('/secrets/');
    }
  }
);
