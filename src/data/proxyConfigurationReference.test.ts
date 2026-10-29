import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { ProxyConfigurationQuery } from '../core/proxyConfigurationReference';
import { clusterScope } from '../core/scope';
import { loadProxyConfigurationCandidate } from './proxyConfigurationReference';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
const group = 'networking.istio.io';
const query: ProxyConfigurationQuery = {
  kind: 'DestinationRule',
  path: `/apis/${group}/v1/namespaces/bookinfo/destinationrules/reviews.v1`,
};
const resource = (kind = 'DestinationRule', version = 'v1') => ({
  kind,
  apiVersion: `${group}/${version}`,
  metadata: {
    name: 'reviews.v1',
    namespace: 'bookinfo',
    uid: 'configuration-uid',
    resourceVersion: '10',
  },
});
function serve(object: unknown, version = 'v1') {
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    if (path === `/apis/${group}`)
      return { name: group, versions: [{ groupVersion: `${group}/${version}` }] };
    if (path === `/apis/${group}/${version}`)
      return {
        groupVersion: `${group}/${version}`,
        resources: [
          { kind: 'DestinationRule', name: 'destinationrules', namespaced: true },
          { kind: 'VirtualService', name: 'virtualservices', namespaced: true },
        ],
      };
    return object;
  });
}
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});
it('captures kind/path/context before discovery and reports the current served version separately', async () => {
  serve(resource('DestinationRule', 'v1beta1'), 'v1beta1');
  const scope = { cluster: 'alpha' };
  const input = { ...query };
  const pending = loadProxyConfigurationCandidate(scope, input, new AbortController().signal);
  scope.cluster = 'beta';
  input.kind = 'VirtualService';
  input.path = '/changed';
  const result = await pending;
  expect(result).toMatchObject({
    cluster: 'alpha',
    namespace: 'bookinfo',
    name: 'reviews.v1',
    kind: 'DestinationRule',
    uid: 'configuration-uid',
    resourceVersion: '10',
    observedApiVersion: `${group}/v1`,
    apiVersion: `${group}/v1beta1`,
    routeName: 'kiali-config-destination-rule-detail',
  });
  expect(vi.mocked(ApiProxy.request).mock.calls.map(call => call[0])).toEqual([
    `/apis/${group}`,
    `/apis/${group}/v1beta1`,
    `/apis/${group}/v1beta1/namespaces/bookinfo/destinationrules/reviews.v1`,
  ]);
  for (const [, options] of vi.mocked(ApiProxy.request).mock.calls)
    expect(options).toMatchObject({ cluster: 'alpha', signal: expect.any(AbortSignal) });
});
it('resolves VirtualService references through the separate kind route', async () => {
  serve(resource('VirtualService'));
  expect(
    await loadProxyConfigurationCandidate(
      clusterScope('alpha'),
      {
        kind: 'VirtualService',
        path: query.path.replace('destinationrules', 'virtualservices'),
      },
      new AbortController().signal
    )
  ).toMatchObject({
    kind: 'VirtualService',
    routeName: 'kiali-config-virtual-service-detail',
  });
});
it.each(['kind', 'version', 'name', 'namespace', 'uid', 'resourceVersion'])(
  'rejects mismatched configuration %s',
  async field => {
    const value = resource();
    if (field === 'kind') value.kind = 'VirtualService';
    if (field === 'version') value.apiVersion = 'wrong/v1';
    if (field === 'name') value.metadata.name = 'different';
    if (field === 'namespace') value.metadata.namespace = 'other';
    if (field === 'uid') value.metadata.uid = '';
    if (field === 'resourceVersion') value.metadata.resourceVersion = ' ';
    serve(value);
    await expect(
      loadProxyConfigurationCandidate(clusterScope('alpha'), query, new AbortController().signal)
    ).rejects.toThrow();
  }
);
it('keeps API absence distinct from denied discovery and missing objects', async () => {
  vi.mocked(ApiProxy.request).mockRejectedValue({ status: 404 });
  await expect(
    loadProxyConfigurationCandidate(clusterScope('alpha'), query, new AbortController().signal)
  ).rejects.toThrow('API unavailable: absent');
  vi.mocked(ApiProxy.request).mockRejectedValue({ status: 403, message: 'Discovery denied' });
  await expect(
    loadProxyConfigurationCandidate(clusterScope('alpha'), query, new AbortController().signal)
  ).rejects.toEqual({ status: 403, message: 'Discovery denied' });
  serve(resource());
  const normal = vi.mocked(ApiProxy.request).getMockImplementation()!;
  vi.mocked(ApiProxy.request).mockImplementation((path, options, force) => {
    if (String(path).includes('/namespaces/'))
      return Promise.reject({ status: 404, message: 'Object missing' });
    return normal(path, options, force);
  });
  await expect(
    loadProxyConfigurationCandidate(clusterScope('alpha'), query, new AbortController().signal)
  ).rejects.toEqual({ status: 404, message: 'Object missing' });
});
it('rejects wrong resource types and cancellation before any request', async () => {
  await expect(
    loadProxyConfigurationCandidate(
      clusterScope('alpha'),
      { ...query, path: query.path.replace('destinationrules', 'secrets') },
      new AbortController().signal
    )
  ).rejects.toThrow('canonical supported');
  const controller = new AbortController();
  controller.abort();
  await expect(
    loadProxyConfigurationCandidate(clusterScope('alpha'), query, controller.signal)
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
it('bounds discovery/object reads even when transport ignores abort', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(ApiProxy.request).mockImplementation(() => new Promise(() => {}));
    const pending = loadProxyConfigurationCandidate(
      clusterScope('alpha'),
      query,
      new AbortController().signal
    );
    const rejected = expect(pending).rejects.toThrow('exceeded 15 seconds');
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    expect(vi.mocked(ApiProxy.request).mock.calls[0][1]?.signal?.aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
