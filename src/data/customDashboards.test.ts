import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { CustomDashboardQuery } from '../core/customDashboards';
import { loadCustomDashboard } from './customDashboards';
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));
const provider = { namespace: 'monitoring', service: 'prometheus', port: '9090', basePath: '' };
const query = (): CustomDashboardQuery => ({
  namespace: 'bookinfo',
  metricCluster: 'east',
  singleClusterConfirmed: false,
  namespaceLabel: 'namespace',
  clusterLabel: 'cluster',
  minutes: 15,
  end: 10000,
  dashboard: {
    name: 'runtime',
    title: 'Runtime',
    items: Array.from({ length: 8 }, (_, i) => ({
      chart: {
        name: `chart-${i}`,
        metricName: `metric_${i}`,
        unit: 'bytes',
        dataType: i === 1 ? 'rate' : 'raw',
        unitScale: 0.001,
      },
    })),
  },
});
const matrix = (
  values: [number, string][] = [
    [9985, 'NaN'],
    [10000, '-2000'],
  ],
  labels = {}
) => ({
  status: 'success',
  data: { resultType: 'matrix', result: [{ metric: labels, values }] },
});
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});
it('captures settings/range and bounds eight jobs to three workers with independent errors', async () => {
  let active = 0;
  let peak = 0;
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise(resolve => setTimeout(resolve, 2));
      const url = new URL(String(path), 'http://example.test');
      expect(url.searchParams.get('start')).toBe('9100');
      expect(url.searchParams.get('end')).toBe('10000');
      expect(url.searchParams.get('step')).toBe('15');
      const expression = url.searchParams.get('query') ?? '';
      if (expression.includes('metric_2')) throw { status: 403, message: 'Metric denied' };
      return matrix(undefined, expression.includes('metric_3') ? { leftover: 'label' } : {});
    } finally {
      active--;
    }
  });
  const scope = { cluster: 'alpha' };
    const endpoint = { ...provider };
    const input = query();
  const expected = structuredClone(input);
  const pending = loadCustomDashboard(scope, endpoint, input, new AbortController().signal);
  scope.cluster = 'other';
  endpoint.service = 'other';
  input.dashboard.items.length = 0;
  input.end = 0;
  const result = await pending;
  expect(result.query).toEqual(expected);
  expect(peak).toBe(3);
  expect(result.charts).toHaveLength(8);
  expect(result.charts[0].read).toMatchObject({
    ok: true,
    result: { series: [{ samples: [{ value: null }, { value: -2 }] }] },
  });
  expect(result.charts[1].read).toMatchObject({ ok: false, error: { kind: 'invalid-response' } });
  expect(result.charts[2].read).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  expect(result.charts[3].read).toMatchObject({ ok: false, error: { kind: 'invalid-response' } });
  for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
    expect(path).toContain('/services/prometheus:9090/');
    expect(options?.cluster).toBe('alpha');
  }
});
it.each(['overflow', 'underflow', 'budget', 'time'])(
  'reports %s failures instead of substituting zero',
  async mode => {
    const input = query();
    input.dashboard.items = input.dashboard.items.slice(0, 1);
    input.dashboard.items[0].chart.unitScale =
      mode === 'overflow' ? 1e12 : mode === 'underflow' ? 1e-300 : 1;
    vi.mocked(ApiProxy.request).mockResolvedValue(
      matrix(
        mode === 'budget'
          ? Array.from({ length: 62 }, (_, i) => [9100 + i * 15, '1'])
          : [
              [
                mode === 'time' ? 10005 : 10000,
                mode === 'overflow' ? '1e308' : mode === 'underflow' ? '1e-300' : '1',
              ],
            ]
      )
    );
    const result = await loadCustomDashboard(
      { cluster: 'alpha' },
      provider,
      input,
      new AbortController().signal
    );
    expect(result.charts[0].read).toMatchObject({ ok: false, error: { kind: 'invalid-response' } });
  }
);
it('times out active charts and cancels queued jobs, including transports ignoring abort', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(ApiProxy.request).mockImplementation(() => new Promise(() => {}));
    const pending = loadCustomDashboard(
      { cluster: 'alpha' },
      provider,
      query(),
      new AbortController().signal
    );
    const failure = expect(pending).rejects.toThrow('Custom dashboard reads exceeded 15 seconds');
    await vi.advanceTimersByTimeAsync(15000);
    await failure;
    expect(ApiProxy.request).toHaveBeenCalledTimes(3);
    expect(
      vi.mocked(ApiProxy.request).mock.calls.every(([, options]) => options?.signal?.aborted)
    ).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
it('does not send an unscoped or invalid template request', async () => {
  await expect(
    loadCustomDashboard(
      { cluster: 'alpha' },
      provider,
      { ...query(), clusterLabel: null },
      new AbortController().signal
    )
  ).rejects.toThrow('Confirm');
  await expect(
    loadCustomDashboard(
      { cluster: 'alpha' },
      provider,
      { ...query(), namespace: '' },
      new AbortController().signal
    )
  ).rejects.toThrow('namespace');
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
