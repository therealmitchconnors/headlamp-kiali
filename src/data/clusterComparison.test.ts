import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { ClusterComparisonQuery } from '../core/clusterComparison';
import { loadClusterComparison } from './clusterComparison';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));
const endpoint = { namespace: 'monitoring', service: 'prometheus', port: '9090', basePath: '' };
const end = 1700000000;
const query: ClusterComparisonQuery = {
  namespace: 'bookinfo',
  start: end - 3600,
  end,
  step: 60,
  targets: Array.from({ length: 8 }, (_, index) => ({
    cluster: `cluster-${index}`,
    endpoint,
    meshClusterName: `logical-${index}`,
    telemetryCluster: `mesh-${index}`,
    telemetryStore: null,
  })),
};
function response(path: string, cluster: string) {
  if (path === '/apis/networking.istio.io')
    return { name: 'networking.istio.io', versions: [{ version: 'v1' }] };
  if (path === '/api/v1/namespaces/bookinfo')
    return {
      kind: 'Namespace',
      apiVersion: 'v1',
      metadata: { name: 'bookinfo', uid: `ns-${cluster}` },
    };
  if (path.includes('/proxy/api/v1/query_range'))
    return {
      status: 'success',
      data: {
        resultType: 'matrix',
        result: [
          {
            metric: { request_protocol: 'http', response_code: '200', grpc_response_status: '' },
            values: Array.from(
              { length: (query.end - query.start) / query.step + 1 },
              (_, index) => [query.start + index * query.step, '0']
            ),
          },
        ],
      },
    };
  throw new Error(`Unexpected request ${path}`);
}
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});
it('limits fan-out to three active reads and preserves every context/metric identity', async () => {
  let active = 0;
  let peak = 0;
  vi.mocked(ApiProxy.request).mockImplementation(async (path, options) => {
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise(resolve => setTimeout(resolve, 1));
      return response(String(path), options?.cluster ?? '');
    } finally {
      active--;
    }
  });
  const mutable = structuredClone(query);
  const pending = loadClusterComparison(mutable, new AbortController().signal);
  mutable.targets[0].cluster = 'changed';
  mutable.targets[0].endpoint!.service = 'changed';
  mutable.targets[0].meshClusterName = 'changed';
  mutable.targets[0].telemetryCluster = 'changed';
  mutable.targets[0].telemetryStore = 'changed';
  const result = await pending;
  expect(peak).toBe(3);
  expect(result.clusters).toHaveLength(8);
  expect(result.query.targets[0]).toEqual(query.targets[0]);
  expect(vi.mocked(ApiProxy.request).mock.calls).toHaveLength(24);
  for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
    const index = Number(options?.cluster?.split('-')[1]);
    expect(Number.isInteger(index)).toBe(true);
    if (String(path).includes('/proxy/')) {
      expect(String(path)).toContain('/services/prometheus:9090/');
      expect(new URL(String(path), 'http://example.test').searchParams.get('query')).toContain(
        `destination_cluster="mesh-${index}"`
      );
      const params = new URL(String(path), 'http://example.test').searchParams;
      expect(params.get('start')).toBe(String(query.start));
      expect(params.get('end')).toBe(String(query.end));
      expect(params.get('step')).toBe('60');
    }
    expect(options?.method).toBeUndefined();
  }
  expect(result.clusters[0].metrics.status).toBe('ready');
  if (result.clusters[0].metrics.status === 'ready')
    expect(result.clusters[0].metrics.value.points[0].requests).toBe(0);
  expect(result.stores).toHaveLength(8);
  expect(result.stores.every(store => store.status === 'ready')).toBe(true);
});
it('retains per-source errors and skips unconfigured metrics without erasing readable evidence', async () => {
  vi.mocked(ApiProxy.request).mockImplementation(async (path, options) => {
    if (options?.cluster === 'denied' && path === '/apis/networking.istio.io')
      throw { status: 403, message: 'API denied' };
    if (options?.cluster === 'denied' && path === '/api/v1/namespaces/bookinfo')
      throw { status: 404, message: 'Namespace absent' };
    if (options?.cluster === 'denied' && String(path).includes('/proxy/'))
      throw { status: 403, message: 'Prometheus denied' };
    if (String(path).includes('/proxy/'))
      return { status: 'success', data: { resultType: 'matrix', result: [] } };
    return response(String(path), options?.cluster ?? '');
  });
  const result = await loadClusterComparison(
    {
      ...query,
      targets: [
        {
          cluster: 'denied',
          endpoint,
          meshClusterName: null,
          telemetryCluster: 'id',
          telemetryStore: null,
        },
        {
          cluster: 'unconfigured',
          endpoint,
          meshClusterName: null,
          telemetryCluster: null,
          telemetryStore: null,
        },
      ],
    },
    new AbortController().signal
  );
  expect(result.clusters[0]).toMatchObject({
    istio: { status: 'error', error: { kind: 'forbidden' } },
    namespace: { status: 'error', error: { kind: 'not-found' } },
    metrics: { status: 'error', error: { kind: 'forbidden' } },
  });
  expect(result.clusters[1]).toMatchObject({
    namespace: { status: 'ready' },
    metrics: { status: 'not-configured' },
  });
  expect(
    vi.mocked(ApiProxy.request).mock.calls.filter(([path]) => String(path).includes('/proxy/'))
  ).toHaveLength(1);
  expect(result.stores[0]).toMatchObject({ status: 'incomplete', points: [] });
});
it('preserves invalid-response errors from metrics and namespace identity mismatch', async () => {
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    if (String(path).includes('/proxy/'))
      return { status: 'success', data: { resultType: 'vector', result: [] } };
    if (path === '/api/v1/namespaces/bookinfo')
      return { kind: 'Namespace', apiVersion: 'v1', metadata: { name: 'other', uid: 'other' } };
    return response(String(path), 'cluster-0');
  });
  const result = await loadClusterComparison(
    { ...query, targets: [query.targets[0]] },
    new AbortController().signal
  );
  expect(result.clusters[0].namespace).toMatchObject({
    status: 'error',
    error: { kind: 'invalid-response' },
  });
  expect(result.clusters[0].metrics).toMatchObject({
    status: 'error',
    error: { kind: 'invalid-response' },
  });
});
it.each(['extra-label', 'out-of-range', 'over-budget-series'])(
  'rejects %s metric series instead of summing incompatible observations',
  async mode => {
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      if (String(path).includes('/proxy/'))
        return {
          status: 'success',
          data: {
            resultType: 'matrix',
            result: Array.from(
              { length: mode === 'over-budget-series' ? 2001 : 1 },
              (_, index) => ({
                metric: {
                  request_protocol: 'http',
                  response_code: '200',
                  ...(mode === 'extra-label' ? { source_cluster: 'other' } : {}),
                  ...(mode === 'over-budget-series' ? { response_code: String(200 + index) } : {}),
                },
                values: [
                  [
                    mode === 'out-of-range' ? query.start - 60 : query.start,
                    '10',
                  ],
                ],
              })
            ),
          },
        };
      return response(String(path), 'cluster-0');
    });
    const result = await loadClusterComparison(
      { ...query, targets: [query.targets[0]] },
      new AbortController().signal
    );
    expect(result.clusters[0].metrics).toMatchObject({
      status: 'error',
      error: { kind: 'invalid-response' },
    });
  }
);
it('accepts more than eight ordinary status series within the bounded response budget', async () => {
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    if (String(path).includes('/proxy/'))
      return {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: Array.from({ length: 9 }, (_, index) => ({
            metric: { request_protocol: 'http', response_code: String(200 + index) },
            values: Array.from(
              { length: (query.end - query.start) / query.step + 1 },
              (_, sample) => [query.start + sample * query.step, '1']
            ),
          })),
        },
      };
    return response(String(path), 'cluster-0');
  });
  const result = await loadClusterComparison(
    { ...query, targets: [query.targets[0]] },
    new AbortController().signal
  );
  expect(result.clusters[0].metrics.status).toBe('ready');
  if (result.clusters[0].metrics.status === 'ready')
    expect(result.clusters[0].metrics.value.points[0].requests).toBe(9);
  expect(result.stores[0].status).toBe('ready');
});
it('times out a hung target while preserving its prior observations and other targets', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(ApiProxy.request).mockImplementation(async (path, options) => {
      if (options?.cluster === 'cluster-0' && path === '/api/v1/namespaces/bookinfo')
        return new Promise(() => {});
      return response(String(path), options?.cluster ?? '');
    });
    const pending = loadClusterComparison(
      { ...query, targets: query.targets.slice(0, 2) },
      new AbortController().signal
    );
    await vi.advanceTimersByTimeAsync(15000);
    const result = await pending;
    expect(result.clusters[0]).toMatchObject({
      istio: { status: 'ready' },
      namespace: { status: 'error', error: { message: expect.stringContaining('15 seconds') } },
      metrics: { status: 'error' },
    });
    expect(result.clusters[1].metrics.status).toBe('ready');
  } finally {
    vi.useRealTimers();
  }
});
it('cancels active reads and prevents queued targets from starting', async () => {
  vi.mocked(ApiProxy.request).mockImplementation(() => new Promise(() => {}));
  const controller = new AbortController();
  const pending = loadClusterComparison(query, controller.signal);
  const rejection = expect(pending).rejects.toThrow();
  await Promise.resolve();
  controller.abort();
  await rejection;
  expect(vi.mocked(ApiProxy.request).mock.calls.length).toBeLessThanOrEqual(3);
  expect(
    vi.mocked(ApiProxy.request).mock.calls.every(([, options]) => options?.signal?.aborted)
  ).toBe(true);
});
