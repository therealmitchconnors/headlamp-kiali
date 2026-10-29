import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { CORRELATION_SOURCES } from './correlation';
import { loadGraphResources } from './graphResources';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
const target = {
  cluster: 'alpha',
  namespace: 'bookinfo',
  kind: 'workload' as const,
  names: ['reviews-v1'],
};
function response(path: string) {
  if (path === '/apis/networking.istio.io') throw { status: 404, message: 'Not served' };
  const source = CORRELATION_SOURCES.find(source =>
    new URL(path, 'http://example.test').pathname.endsWith(`/${source.plural}`)
  );
  if (!source) throw new Error('Unexpected request');
  return {
    apiVersion: source.apiVersion,
    kind: `${source.kind}List`,
    metadata: { resourceVersion: '1' },
    items:
      source.kind === 'Deployment'
        ? [
            {
              apiVersion: source.apiVersion,
              kind: source.kind,
              metadata: {
                name: 'reviews-v1',
                namespace: 'bookinfo',
                uid: 'observed-uid',
                resourceVersion: '1',
              },
              spec: { template: { metadata: { labels: { app: 'reviews', version: 'v1' } } } },
            },
          ]
        : [],
  };
}
beforeEach(() => {
  vi.mocked(ApiProxy.request)
    .mockReset()
    .mockImplementation(async path => response(String(path)));
});
it('uses bounded namespace-scoped reads and captures the target before deferred work', async () => {
  const mutable = structuredClone(target);
  const pending = loadGraphResources(mutable, null, new AbortController().signal);
  mutable.cluster = 'beta';
  mutable.names[0] = 'different';
  const result = await pending;
  expect(result.target).toEqual(target);
  expect(result.candidates[0].identity.uid).toBe('observed-uid');
  expect(vi.mocked(ApiProxy.request).mock.calls).toHaveLength(10);
  for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
    if (path !== '/apis/networking.istio.io')
      expect(String(path)).toContain('/namespaces/bookinfo/');
    expect(options?.cluster).toBe('alpha');
    expect(options?.method).toBeUndefined();
  }
});
it('does not present a candidate from incomplete or denied namespace evidence', async () => {
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    if (String(path).includes('/pods?')) throw { status: 403, message: 'Pod access denied' };
    return response(String(path));
  });
  await expect(loadGraphResources(target, null, new AbortController().signal)).rejects.toThrow(
    'Pod access denied'
  );
});
it('enforces a deadline even when transport ignores abort', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(ApiProxy.request).mockImplementation(() => new Promise(() => {}));
    const pending = loadGraphResources(target, null, new AbortController().signal);
    const rejected = expect(pending).rejects.toThrow('15 seconds');
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    expect(vi.mocked(ApiProxy.request).mock.calls).toHaveLength(3);
    expect(
      vi.mocked(ApiProxy.request).mock.calls.every(([, options]) => options?.signal?.aborted)
    ).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
