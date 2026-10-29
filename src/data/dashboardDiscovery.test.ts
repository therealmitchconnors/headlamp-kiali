import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { DashboardDiscoveryQuery } from '../core/dashboardDiscovery';
import { discoverCustomDashboards } from './dashboardDiscovery';
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));
const provider = { namespace: 'monitoring', service: 'prometheus', port: '9090', basePath: '' };
const query = (): DashboardDiscoveryQuery => ({
  namespace: 'bookinfo',
  namespaceLabel: 'namespace',
  clusterLabel: 'cluster',
  metricCluster: 'east',
  singleClusterConfirmed: false,
  minutes: 15,
  end: 10000,
  templates: [
    {
      name: 'go',
      title: 'Go charts',
      runtime: 'Go',
      discoverOn: 'go_info',
      items: [
        {
          chart: {
            name: 'Memory',
            metricName: 'memory_bytes',
            unit: 'bytes',
            dataType: 'raw',
          },
        },
      ],
    },
  ],
});
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});
it('captures definitions, source and time before an awaited read and issues only one GET', async () => {
  vi.mocked(ApiProxy.request).mockResolvedValue({
    status: 'success',
    data: {
      resultType: 'vector',
      result: [{ metric: { __name__: 'go_info' }, value: [10000, '0'] }],
    },
  });
  const input = query();
  const endpoint = { ...provider };
  const scope = { cluster: 'alpha' };
  const pending = discoverCustomDashboards(scope, endpoint, input, new AbortController().signal);
  input.templates[0].title = 'mutated';
  input.end = 0;
  endpoint.service = 'other';
  scope.cluster = 'other';
  const result = await pending;
  expect(result.runtimes[0].dashboards[0].title).toBe('Go charts');
  expect(result.query.end).toBe(10000);
  expect(ApiProxy.request).toHaveBeenCalledTimes(1);
  const [path, options] = vi.mocked(ApiProxy.request).mock.calls[0];
  expect(path).toContain('/services/prometheus:9090/proxy/api/v1/query?');
  expect(String(path)).not.toContain('query_range');
  expect(options?.cluster).toBe('alpha');
});
it('preserves denial and malformed-response errors rather than an empty success', async () => {
  vi.mocked(ApiProxy.request).mockRejectedValue({ status: 403, message: 'denied' });
  await expect(
    discoverCustomDashboards({ cluster: 'alpha' }, provider, query(), new AbortController().signal)
  ).rejects.toMatchObject({ status: 403 });
  vi.mocked(ApiProxy.request).mockResolvedValue({
    status: 'success',
    data: { resultType: 'matrix', result: [] },
  });
  await expect(
    discoverCustomDashboards({ cluster: 'alpha' }, provider, query(), new AbortController().signal)
  ).rejects.toThrow('result type');
});
it('rejects invalid scope before transport and honors a captured deadline even if transport ignores abort', async () => {
  await expect(
    discoverCustomDashboards(
      { cluster: 'alpha' },
      provider,
      { ...query(), clusterLabel: null },
      new AbortController().signal
    )
  ).rejects.toThrow('Confirm');
  expect(ApiProxy.request).not.toHaveBeenCalled();
  vi.useFakeTimers();
  try {
    vi.mocked(ApiProxy.request).mockImplementation(() => new Promise(() => {}));
    const pending = discoverCustomDashboards(
      { cluster: 'alpha' },
      provider,
      query(),
      new AbortController().signal
    );
    const failure = expect(pending).rejects.toThrow('Dashboard discovery exceeded 15 seconds');
    await vi.advanceTimersByTimeAsync(15000);
    await failure;
    expect(vi.mocked(ApiProxy.request).mock.calls[0][1]?.signal?.aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
