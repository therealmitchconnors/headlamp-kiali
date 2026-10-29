import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { SignalQuery, TRAFFIC_SIGNAL_KEYS } from '../core/trafficSignals';
import { loadTrafficSignals } from './trafficSignals';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));
const endpoint = { namespace: 'monitoring', service: 'prometheus', port: '9090', basePath: '' };
const query: SignalQuery = {
  namespace: 'bookinfo',
  telemetryCluster: 'Kubernetes',
  direction: 'inbound',
  minutes: 15,
  end: 10000,
  signals: [...TRAFFIC_SIGNAL_KEYS],
};
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});
it('captures all eight jobs and connection/scope inputs with three workers and per-signal failures', async () => {
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
      if (expression.includes('istio_tcp_connections_closed_total'))
        throw { status: 403, message: 'Close rate denied' };
      return {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: expression.includes('istio_response_messages_total')
                ? { extra: 'dimension' }
                : {},
              values: [
                [9985, 'NaN'],
                [10000, '0'],
              ],
            },
          ],
        },
      };
    } finally {
      active--;
    }
  });
  const scope = { cluster: 'alpha' };
  const provider = { ...endpoint };
  const input = structuredClone(query);
  const pending = loadTrafficSignals(scope, provider, input, new AbortController().signal);
  scope.cluster = 'beta';
  provider.service = 'other';
  input.signals.length = 0;
  input.end = 0;
  const result = await pending;
  expect(result.query).toEqual(query);
  expect(peak).toBe(3);
  expect(result.metrics.map(item => item.key)).toEqual(query.signals);
  expect(result.metrics.filter(item => item.read.ok)).toHaveLength(6);
  expect(result.metrics.find(item => item.key === 'grpc_received')?.read).toMatchObject({
    ok: false,
    error: { kind: 'invalid-response' },
  });
  expect(result.metrics.find(item => item.key === 'tcp_closed')?.read).toMatchObject({
    ok: false,
    error: { kind: 'forbidden' },
  });
  for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
    expect(String(path)).toContain('/services/prometheus:9090/');
    expect(options?.cluster).toBe('alpha');
  }
});
it('times out active signals and never starts queued jobs after cancellation', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(ApiProxy.request).mockImplementation(() => new Promise(() => {}));
    const pending = loadTrafficSignals(
      { cluster: 'alpha' },
      endpoint,
      query,
      new AbortController().signal
    );
    const rejected = expect(pending).rejects.toThrow('Traffic signal reads exceeded 15 seconds');
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
it('rejects invalid selections and already cancelled reads before transport', async () => {
  await expect(
    loadTrafficSignals(
      { cluster: 'alpha' },
      endpoint,
      { ...query, signals: [] },
      new AbortController().signal
    )
  ).rejects.toThrow('distinct');
  const controller = new AbortController();
  controller.abort();
  await expect(
    loadTrafficSignals({ cluster: 'alpha' }, endpoint, query, controller.signal)
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
