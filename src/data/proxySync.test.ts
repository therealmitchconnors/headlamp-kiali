import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import synczFixture from '../../test-files/diagnostics/syncz.json?raw';
import { DiagnosticPod } from '../core/diagnostics';
import { clusterScope } from '../core/scope';
import { loadDiagnosticPod } from './diagnostics';
import { loadProxySyncSnapshot } from './proxySync';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));
vi.mock('./diagnostics', () => ({ loadDiagnosticPod: vi.fn() }));

const pod: DiagnosticPod = {
  namespace: 'istio-system',
  name: 'istiod-123',
  uid: 'control-plane-uid',
  containers: [
    {
      name: 'discovery',
      type: 'regular',
      nativeSidecar: false,
      ready: true,
      restarts: 2,
      ports: [{ name: 'http-debug', containerPort: 8080 }],
    },
  ],
};

beforeEach(() => {
  vi.useRealTimers();
  vi.mocked(ApiProxy.request).mockReset().mockImplementation(async path =>
    String(path).endsWith('/debug/syncz')
      ? new Response(synczFixture, { headers: { 'Content-Type': 'application/json' } })
      : new Response(JSON.stringify(pod), { headers: { 'Content-Type': 'application/json' } })
  );
  vi.mocked(loadDiagnosticPod).mockReset().mockResolvedValue(pod);
});

afterEach(() => {
  vi.useRealTimers();
});

it('reads only the declared control-plane Pod proxy endpoint and retains exact Pod provenance', async () => {
  const result = await loadProxySyncSnapshot(
    clusterScope('alpha'),
    pod,
    new AbortController().signal
  );
  expect(result.target).toEqual({
    namespace: 'istio-system',
    pod: 'istiod-123',
    uid: 'control-plane-uid',
    container: 'discovery',
    restarts: 2,
    port: 8080,
  });
  expect(result.records[0].resources.find(resource => resource.name === 'EDS')?.state).toBe(
    'stale'
  );
  const [path, options] = vi.mocked(ApiProxy.request).mock.calls.find(([value]) =>
    String(value).endsWith('/debug/syncz')
  )!;
  expect(path).toBe(
    '/api/v1/namespaces/istio-system/pods/istiod-123:8080/proxy/debug/syncz'
  );
  expect(options).toMatchObject({
    cluster: 'alpha',
    isJSON: false,
    autoLogoutOnAuthError: false,
    cache: 'no-store',
    headers: { Accept: '*/*' },
  });
  expect(options?.method).toBeUndefined();
  expect(loadDiagnosticPod).toHaveBeenCalledTimes(2);
});

it.each([401, 403])('surfaces HTTP %s without another endpoint or fallback', async status => {
  vi.mocked(ApiProxy.request).mockResolvedValueOnce(
    new Response('denied', { status, statusText: 'Denied' })
  );
  await expect(
    loadProxySyncSnapshot(clusterScope('alpha'), pod, new AbortController().signal)
  ).rejects.toMatchObject({ status });
  expect(ApiProxy.request).toHaveBeenCalledTimes(1);
  expect(String(vi.mocked(ApiProxy.request).mock.calls[0][0])).toContain('/debug/syncz');
});

it('rejects a replaced or restarted control-plane identity instead of attributing stale sync rows', async () => {
  vi.mocked(loadDiagnosticPod)
    .mockResolvedValueOnce(pod)
    .mockResolvedValueOnce({
      ...pod,
      containers: [{ ...pod.containers[0], restarts: 3 }],
    });
  await expect(
    loadProxySyncSnapshot(clusterScope('alpha'), pod, new AbortController().signal)
  ).rejects.toThrow('identity changed');
  vi.mocked(loadDiagnosticPod).mockReset().mockResolvedValueOnce({
    ...pod,
    uid: 'replacement-uid',
  });
  await expect(
    loadProxySyncSnapshot(clusterScope('alpha'), pod, new AbortController().signal)
  ).rejects.toThrow('replaced');
  expect(ApiProxy.request).toHaveBeenCalledTimes(1);
});

it.each([
  ['missing declared port', { ...pod, containers: [{ ...pod.containers[0], ports: [] }] }],
  ['unknown restarts', { ...pod, containers: [{ ...pod.containers[0], restarts: null }] }],
])('does not request syncz for %s', async (_label, target) => {
  vi.mocked(loadDiagnosticPod).mockResolvedValue(target);
  await expect(
    loadProxySyncSnapshot(clusterScope('alpha'), pod, new AbortController().signal)
  ).rejects.toThrow();
  expect(ApiProxy.request).not.toHaveBeenCalled();
});

it('rejects oversized and malformed source payloads', async () => {
  vi.mocked(ApiProxy.request).mockResolvedValueOnce(new Response('x'.repeat(262145)));
  await expect(
    loadProxySyncSnapshot(clusterScope('alpha'), pod, new AbortController().signal)
  ).rejects.toThrow('exceeds 256 KiB');
  vi.mocked(ApiProxy.request).mockResolvedValueOnce(new Response('{'));
  await expect(
    loadProxySyncSnapshot(clusterScope('alpha'), pod, new AbortController().signal)
  ).rejects.toThrow('not valid JSON');
});

it('cancels a late sync response and does not perform the trailing identity read', async () => {
  vi.useFakeTimers();
  let resolveLate: (response: Response) => void = () => {};
  vi.mocked(ApiProxy.request).mockImplementation(
    (_path, options) =>
      new Promise(resolve => {
        resolveLate = resolve;
        options?.signal?.addEventListener('abort', () => {}, { once: true });
      })
  );
  const pending = loadProxySyncSnapshot(clusterScope('alpha'), pod, new AbortController().signal);
  const assertion = expect(pending).rejects.toThrow('exceeded 15 seconds');
  await vi.advanceTimersByTimeAsync(15000);
  await assertion;
  resolveLate(new Response(synczFixture));
  await Promise.resolve();
  expect(loadDiagnosticPod).toHaveBeenCalledTimes(1);
});
