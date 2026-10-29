import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { CORRELATION_SOURCES } from './correlation';
import {
  assertTrafficProposalFresh,
  assertTrafficSourceCurrent,
  assertTrafficTargetsAbsent,
  loadServiceTrafficSource,
  prepareServiceTraffic,
} from './serviceTraffic';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
const query = { namespace: 'bookinfo', service: 'reviews', identityDomain: 'svc.cluster.local' };
const service = {
  apiVersion: 'v1',
  kind: 'Service',
  metadata: { name: 'reviews', namespace: 'bookinfo', uid: 'service-uid', resourceVersion: '1' },
  spec: { selector: { app: 'reviews' }, ports: [{ name: 'http', port: 9080 }] },
};
const list = (kind: string, apiVersion: string, items: unknown[]) => ({
  kind: `${kind}List`,
  apiVersion,
  metadata: { resourceVersion: '1' },
  items,
});
function response(path: string) {
  const url = new URL(path, 'http://example.test');
  if (url.pathname === '/api/v1/namespaces/bookinfo/services/reviews') return service;
  const source = CORRELATION_SOURCES.find(source => url.pathname.endsWith(`/${source.plural}`));
  if (source)
    return list(
      source.kind,
      source.apiVersion,
      source.kind === 'Service'
        ? [service]
        : source.kind === 'Deployment'
        ? ['v1', 'v2'].map(version => ({
            metadata: { name: `reviews-${version}`, namespace: 'bookinfo', uid: version },
            spec: { template: { metadata: { labels: { app: 'reviews', version } } } },
          }))
        : []
    );
  if (url.pathname === '/apis/networking.istio.io')
    return {
      name: 'networking.istio.io',
      versions: [{ groupVersion: 'networking.istio.io/v1' }],
    };
  if (url.pathname === '/apis/networking.istio.io/v1')
    return {
      groupVersion: 'networking.istio.io/v1',
      resources: [
        { kind: 'DestinationRule', name: 'destinationrules', namespaced: true },
        { kind: 'VirtualService', name: 'virtualservices', namespaced: true },
      ],
    };
  if (url.pathname.endsWith('/destinationrules'))
    return list('DestinationRule', 'networking.istio.io/v1', []);
  if (url.pathname.endsWith('/virtualservices'))
    return list('VirtualService', 'networking.istio.io/v1', []);
  throw { status: 404, message: 'Not found' };
}
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
  vi.mocked(ApiProxy.request).mockImplementation(async path => response(String(path)));
});
it('loads bounded read-only evidence and prepares ordered namespace-local creates', async () => {
  const signal = new AbortController().signal;
  const source = await loadServiceTrafficSource('alpha', query, null, signal);
  expect(source.versionLabel).toBe('version');
  expect(source.conflicts).toEqual([]);
  expect(source.versions.map(version => version.value)).toEqual(['v1', 'v2']);
  const draft = {
    destinationRuleName: 'reviews-new',
    virtualServiceName: 'reviews-new',
    port: 9080,
    subsets: source.versions.map(version => ({
      name: version.subset,
      version: version.value,
      weight: version.weight,
    })),
  };
  const mutations = prepareServiceTraffic(source, draft);
  const tcp = prepareServiceTraffic(source, { ...draft, protocol: 'tcp' });
  expect(tcp[1].spec).toHaveProperty('tcp');
  expect(tcp[1].spec).not.toHaveProperty('http');
  expect(Object.isFrozen(tcp[1].spec)).toBe(true);
  expect(tcp.map(mutation => mutation.target)).toEqual(mutations.map(mutation => mutation.target));
  expect(tcp[0].spec).toEqual(mutations[0].spec);
  expect(mutations.map(mutation => mutation.target.definition.kind)).toEqual([
    'DestinationRule',
    'VirtualService',
  ]);
  await assertTrafficTargetsAbsent(mutations, signal);
  await assertTrafficProposalFresh(source, signal);
  for (const [, options] of vi.mocked(ApiProxy.request).mock.calls) {
    expect(options).toMatchObject({ cluster: 'alpha', signal });
    expect(options?.method).toBeUndefined();
  }
});
it('blocks incomplete ownership, changed Service identity and potentially overlapping hosts', async () => {
  const source = await loadServiceTrafficSource('alpha', query, null, new AbortController().signal);
  vi.mocked(ApiProxy.request).mockImplementation(async path =>
    String(path).endsWith('/services/reviews')
      ? { ...service, metadata: { ...service.metadata, resourceVersion: '2' } }
      : response(String(path))
  );
  await expect(
    assertTrafficSourceCurrent(source.service, new AbortController().signal)
  ).rejects.toThrow('changed');
  await expect(
    loadServiceTrafficSource('alpha', query, null, new AbortController().signal)
  ).rejects.toThrow('changed during discovery');
  vi.mocked(ApiProxy.request).mockImplementation(async path =>
    String(path).includes('/virtualservices?')
      ? list('VirtualService', 'networking.istio.io/v1', [
          {
            metadata: { name: 'existing', namespace: 'bookinfo', uid: 'vs' },
            spec: { hosts: ['reviews.bookinfo'] },
          },
        ])
      : response(String(path))
  );
  await expect(assertTrafficProposalFresh(source, new AbortController().signal)).rejects.toThrow(
    'Overlapping'
  );
  const overlapping = await loadServiceTrafficSource(
    'alpha',
    query,
    null,
    new AbortController().signal
  );
  expect(overlapping.conflicts).toHaveLength(1);
});
it('never treats forbidden reads as proof of absence and cancels without additional API calls', async () => {
  const source = await loadServiceTrafficSource('alpha', query, null, new AbortController().signal);
  const mutations = prepareServiceTraffic(source, {
    destinationRuleName: 'new',
    virtualServiceName: 'new',
    port: 9080,
    subsets: source.versions.map(version => ({
      name: version.subset,
      version: version.value,
      weight: version.weight,
    })),
  });
  vi.mocked(ApiProxy.request).mockRejectedValue({ status: 403, message: 'Denied' });
  await expect(
    assertTrafficTargetsAbsent(mutations, new AbortController().signal)
  ).rejects.toMatchObject({ status: 403 });
  vi.mocked(ApiProxy.request).mockClear();
  const controller = new AbortController();
  controller.abort();
  await expect(loadServiceTrafficSource('alpha', query, null, controller.signal)).rejects.toThrow();
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
