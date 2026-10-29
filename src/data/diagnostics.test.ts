import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { PodLogQuery } from '../core/diagnostics';
import { clusterScope } from '../core/scope';
import { loadDiagnosticPod, loadPodLogSnapshot } from './diagnostics';
import { readClusterText } from './requests';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));
const pod = {
  apiVersion: 'v1',
  kind: 'Pod',
  metadata: { name: 'reviews-123', namespace: 'bookinfo', uid: 'uid' },
  spec: {
    containers: [{ name: 'reviews' }],
    initContainers: [{ name: 'istio-proxy', restartPolicy: 'Always' }],
  },
  status: { initContainerStatuses: [{ name: 'istio-proxy', restartCount: 0, ready: true }] },
};
const query: PodLogQuery = {
  namespace: 'bookinfo',
  pod: 'reviews-123',
  uid: 'uid',
  container: 'istio-proxy',
  tailLines: 200,
  sinceSeconds: 900,
  previous: false,
};
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
  vi.mocked(ApiProxy.request).mockImplementation(async path =>
    String(path).includes('/log?') ? new Response('2026-10-27T00:00:00Z synthetic log\n') : pod
  );
});
it('uses explicit scope and raw SDK responses, then rechecks UID/restarts without exec or forwarding', async () => {
  const result = await loadPodLogSnapshot(
    clusterScope('alpha'),
    query,
    new AbortController().signal
  );
  expect(result.text).toContain('synthetic log');
  expect(result.container.nativeSidecar).toBe(true);
  expect(ApiProxy.request).toHaveBeenCalledTimes(3);
  for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
    expect(options?.cluster).toBe('alpha');
    expect(options?.method).toBeUndefined();
    expect(path).not.toMatch(/exec|portforward|secrets/);
    if (String(path).includes('/log?'))
      expect(options).toMatchObject({
        isJSON: false,
        autoLogoutOnAuthError: false,
        cache: 'no-store',
        headers: { Accept: '*/*' },
      });
  }
});
it.each(['uid', 'restart'])(
  'rejects a changed %s instead of attributing logs to the wrong instance',
  async change => {
    let reads = 0;
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      if (String(path).includes('/log?')) return new Response('text');
      if (++reads === 1) return pod;
      return change === 'uid'
        ? { ...pod, metadata: { ...pod.metadata, uid: 'replacement' } }
        : { ...pod, status: { initContainerStatuses: [{ name: 'istio-proxy', restartCount: 1 }] } };
    });
    await expect(
      loadPodLogSnapshot(clusterScope('alpha'), query, new AbortController().signal)
    ).rejects.toThrow('changed while reading');
  }
);
it('rejects replacements and invalid container selections before fetching log content', async () => {
  await expect(
    loadPodLogSnapshot(
      clusterScope('alpha'),
      { ...query, uid: 'different' },
      new AbortController().signal
    )
  ).rejects.toThrow('replaced');
  await expect(
    loadPodLogSnapshot(
      clusterScope('alpha'),
      { ...query, container: 'missing' },
      new AbortController().signal
    )
  ).rejects.toThrow('no longer present');
  expect(
    vi.mocked(ApiProxy.request).mock.calls.every(([path]) => !String(path).includes('/log?'))
  ).toBe(true);
});
it('enforces a byte bound even when the server ignores its limit and preserves split UTF-8 characters', async () => {
  let cancelled = false;
  const bytes = new TextEncoder().encode('a€b');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 2));
      controller.enqueue(bytes.subarray(2));
    },
    cancel() {
      cancelled = true;
    },
  });
  vi.mocked(ApiProxy.request).mockResolvedValue(new Response(stream));
  const result = await readClusterText(
    clusterScope('alpha'),
    '/api/log',
    new AbortController().signal,
    4
  );
  expect(result).toEqual({ text: 'a€', bytes: 4, limited: true });
  expect(cancelled).toBe(true);
});
it('cancels an unfinished response stream and rejects hosts that return an unexpected raw format', async () => {
  let cancelled = false;
  vi.mocked(ApiProxy.request).mockResolvedValue(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      })
    )
  );
  const controller = new AbortController();
  const pending = readClusterText(clusterScope('alpha'), '/api/log', controller.signal, 100);
  await Promise.resolve();
  controller.abort();
  await expect(pending).rejects.toThrow();
  expect(cancelled).toBe(true);
  vi.mocked(ApiProxy.request).mockResolvedValue('unexpected raw string');
  await expect(
    readClusterText(clusterScope('alpha'), '/api/log', new AbortController().signal, 100)
  ).rejects.toThrow('raw text response');
});
it('times out a stuck diagnostic read and performs no requests after external cancellation', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(ApiProxy.request).mockImplementation(
      (_path, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          );
        })
    );
    const pending = loadPodLogSnapshot(clusterScope('alpha'), query, new AbortController().signal);
    const assertion = expect(pending).rejects.toThrow('exceeded 15 seconds');
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
  } finally {
    vi.useRealTimers();
  }
  vi.mocked(ApiProxy.request).mockClear();
  const controller = new AbortController();
  controller.abort();
  await expect(
    loadDiagnosticPod(clusterScope('alpha'), 'bookinfo', 'reviews-123', controller.signal)
  ).rejects.toThrow();
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
