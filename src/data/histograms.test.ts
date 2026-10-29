import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { HistogramQuery } from '../core/histograms';
import { loadHistograms } from './histograms';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));
const endpoint = { namespace: 'monitoring', service: 'prometheus', port: '9090', basePath: '' };
const query: HistogramQuery = {
  namespace: 'bookinfo',
  telemetryCluster: 'Kubernetes',
  direction: 'inbound',
  minutes: 15,
  end: 10000,
  metric: 'duration',
  summaries: ['avg', 'p50', 'p90', 'p95', 'p99'],
};
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});
it('captures queries/settings, limits concurrency and preserves an independently denied summary', async () => {
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
      if (url.searchParams.get('query')?.includes('0.9,'))
        throw { status: 403, message: 'P90 denied' };
      return {
        status: 'success',
        data: { resultType: 'matrix', result: [{ metric: {}, values: [[10000, '2']] }] },
      };
    } finally {
      active--;
    }
  });
  const selected = { cluster: 'alpha' };
  const provider = { ...endpoint };
  const input = structuredClone(query);
  const pending = loadHistograms(selected, provider, input, new AbortController().signal);
  selected.cluster = 'other';
  provider.service = 'other';
  input.metric = 'responseSize';
  input.summaries.length = 0;
  const result = await pending;
  expect(result.query).toEqual(query);
  expect(peak).toBe(3);
  expect(result.summaries[2].read).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  expect(result.summaries.filter(value => value.read.ok)).toHaveLength(4);
  expect(
    vi
      .mocked(ApiProxy.request)
      .mock.calls.every(
        ([path, options]) =>
          String(path).includes('/services/prometheus:9090/') && options?.cluster === 'alpha'
      )
  ).toBe(true);
});
it('times out hanging summaries and does not start queued requests after cancellation', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(ApiProxy.request).mockImplementation(() => new Promise(() => {}));
    const pending = loadHistograms(
      { cluster: 'alpha' },
      endpoint,
      query,
      new AbortController().signal
    );
    const rejected = expect(pending).rejects.toThrow('15 seconds');
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    expect(ApiProxy.request).toHaveBeenCalledTimes(3);
    expect(
      vi.mocked(ApiProxy.request).mock.calls.every(([, options]) => options?.signal?.aborted)
    ).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
