import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { clusterScope } from '../core/scope';
import { TopologyQuery } from '../core/topology';
import { InvalidResponseError } from './requests';
import { loadTopology } from './topology';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));
const endpoint = { namespace: 'istio-system', service: 'prometheus', port: '9090', basePath: '' };
const query: TopologyQuery = {
  namespace: 'bookinfo',
  telemetryCluster: 'Kubernetes',
  reporter: 'source',
  windowSeconds: 600,
  end: 10000,
  measure: 'tcpTotal',
  includeIdle: false,
};
const empty = { status: 'success', data: { resultType: 'vector', result: [] } };
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});
afterEach(() => vi.useRealTimers());
it('captures scoped time/endpoint, uses only bounded instant reads, and cancels request signals on completion', async () => {
  vi.mocked(ApiProxy.request).mockResolvedValue(empty);
  const mutable = { ...query };
  const read = loadTopology(
    clusterScope('headlamp-alpha'),
    endpoint,
    mutable,
    new AbortController().signal
  );
  mutable.end = 20000;
  mutable.namespace = 'changed';
  const result = await read;
  expect(result.query.end).toBe(10000);
  expect(result.query.namespace).toBe('bookinfo');
  expect(ApiProxy.request).toHaveBeenCalledTimes(2);
  for (const [path, options, autoLogout] of vi.mocked(ApiProxy.request).mock.calls) {
    const url = new URL(String(path), 'http://example.test');
    expect(url.pathname).toBe(
      '/api/v1/namespaces/istio-system/services/prometheus:9090/proxy/api/v1/query'
    );
    expect(url.searchParams.get('time')).toBe('10000');
    expect(options?.cluster).toBe('headlamp-alpha');
    expect(options?.signal?.aborted).toBe(true);
    expect(autoLogout).toBe(false);
  }
});
it('does not turn a failed total-counter read into a partial success; aborts its pending sibling', async () => {
  vi.mocked(ApiProxy.request)
    .mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }))
    .mockImplementationOnce(() => new Promise(() => {}));
  await expect(
    loadTopology(clusterScope('alpha'), endpoint, query, new AbortController().signal)
  ).rejects.toMatchObject({ status: 403 });
  expect(vi.mocked(ApiProxy.request).mock.calls[1][1]?.signal?.aborted).toBe(true);
});
it('reports malformed vectors as invalid responses', async () => {
  vi.mocked(ApiProxy.request).mockResolvedValue({});
  await expect(
    loadTopology(clusterScope('alpha'), endpoint, query, new AbortController().signal)
  ).rejects.toBeInstanceOf(InvalidResponseError);
});
it('races caller cancellation even when the SDK ignores abort', async () => {
  vi.mocked(ApiProxy.request).mockImplementation(() => new Promise(() => {}));
  const controller = new AbortController();
  const read = loadTopology(clusterScope('alpha'), endpoint, query, controller.signal);
  const rejected = expect(read).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejected;
});
it('enforces the read deadline without relying on SDK cancellation', async () => {
  vi.useFakeTimers();
  vi.mocked(ApiProxy.request).mockImplementation(() => new Promise(() => {}));
  const read = loadTopology(clusterScope('alpha'), endpoint, query, new AbortController().signal);
  const rejected = expect(read).rejects.toThrow('exceeded 15 seconds');
  await vi.advanceTimersByTimeAsync(15000);
  await rejected;
  expect(vi.mocked(ApiProxy.request).mock.calls.every(call => call[1]?.signal?.aborted)).toBe(true);
});
