import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { clusterScope } from '../core/scope';
import { loadProxyServiceCandidate } from './proxyService';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));
const query = {
  name: 'outbound|9080|v1|reviews.bookinfo.svc.cluster.local',
  identityDomain: 'svc.cluster.local',
};
const service = () => ({
  kind: 'Service',
  apiVersion: 'v1',
  metadata: { name: 'reviews', namespace: 'bookinfo', uid: 'service-uid', resourceVersion: '123' },
  spec: { type: 'ClusterIP', ports: [{ name: 'http', port: 9080, protocol: 'TCP' }] },
});
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
  vi.mocked(ApiProxy.request).mockResolvedValue(service());
});
it('captures context/name/domain before awaiting and verifies the returned Service identity', async () => {
  const scope = { cluster: 'alpha' };
  const input = { ...query };
  const pending = loadProxyServiceCandidate(scope, input, new AbortController().signal);
  scope.cluster = 'beta';
  input.name = 'outbound|80||other.other.svc.example.test';
  input.identityDomain = 'svc.example.test';
  const result = await pending;
  expect(result).toMatchObject({
    identity: {
      cluster: 'alpha',
      namespace: 'bookinfo',
      kind: 'Service',
      group: '',
      name: 'reviews',
      uid: 'service-uid',
    },
    target: { port: 9080, subset: 'v1' },
    resourceVersion: '123',
    portDeclared: true,
  });
  expect(ApiProxy.request).toHaveBeenCalledWith(
    '/api/v1/namespaces/bookinfo/services/reviews',
    expect.objectContaining({
      cluster: 'alpha',
      signal: expect.any(AbortSignal),
      autoLogoutOnAuthError: false,
    }),
    false
  );
  expect(vi.mocked(ApiProxy.request).mock.calls[0][1]?.signal?.aborted).toBe(true);
});
it.each([
  'name',
  'namespace',
  'uid',
  'resourceVersion',
  'kind',
  'version',
  'ports',
  'port',
  'spec',
])('rejects malformed or mismatched %s without creating a candidate link', async field => {
  const value = service();
  if (field === 'name') value.metadata.name = 'different';
  if (field === 'namespace') value.metadata.namespace = 'other';
  if (field === 'uid') value.metadata.uid = '';
  if (field === 'resourceVersion') value.metadata.resourceVersion = ' ';
  if (field === 'kind') value.kind = 'Pod';
  if (field === 'version') value.apiVersion = 'wrong/v1';
  if (field === 'ports') value.spec.ports = Array(101).fill(value.spec.ports[0]);
  if (field === 'port') value.spec.ports[0].port = 0;
  if (field === 'spec') Object.assign(value, { spec: null });
  vi.mocked(ApiProxy.request).mockResolvedValue(value);
  await expect(
    loadProxyServiceCandidate(clusterScope('alpha'), query, new AbortController().signal)
  ).rejects.toThrow();
});
it('retains the current identity when its port changed or an ExternalName Service has no ports', async () => {
  const value = service();
  value.spec.ports[0].port = 8080;
  vi.mocked(ApiProxy.request).mockResolvedValue(value);
  expect(
    await loadProxyServiceCandidate(clusterScope('alpha'), query, new AbortController().signal)
  ).toMatchObject({
    portDeclared: false,
    ports: [{ port: 8080 }],
    identity: { uid: 'service-uid' },
  });
  vi.mocked(ApiProxy.request).mockResolvedValue({
    ...value,
    spec: { type: 'ExternalName', externalName: 'external.example.test' },
  });
  expect(
    await loadProxyServiceCandidate(clusterScope('alpha'), query, new AbortController().signal)
  ).toMatchObject({
    serviceType: 'ExternalName',
    externalName: 'external.example.test',
    ports: [],
    portDeclared: false,
  });
});
it.each([403, 404])(
  'preserves HTTP %d without interpreting it as historical proxy evidence',
  async status => {
    const error = { status, message: 'Current Service unavailable' };
    vi.mocked(ApiProxy.request).mockRejectedValue(error);
    await expect(
      loadProxyServiceCandidate(clusterScope('alpha'), query, new AbortController().signal)
    ).rejects.toEqual(error);
  }
);
it('does not request an inferred namespace, an external host or a cancelled lookup', async () => {
  for (const name of ['outbound|9080||reviews', 'outbound|9080||api.external.test'])
    await expect(
      loadProxyServiceCandidate(
        clusterScope('alpha'),
        { ...query, name },
        new AbortController().signal
      )
    ).rejects.toThrow('scoped outbound');
  const controller = new AbortController();
  controller.abort();
  await expect(
    loadProxyServiceCandidate(clusterScope('alpha'), query, controller.signal)
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
it('rejects on the 15-second deadline even when the SDK ignores abort', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(ApiProxy.request).mockImplementation(() => new Promise(() => {}));
    const pending = loadProxyServiceCandidate(
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
