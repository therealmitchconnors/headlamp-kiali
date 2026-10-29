import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { clusterScope } from '../core/scope';
import { WorkloadHealthQuery } from '../core/workloadHealth';
import { loadWorkloadHealth } from './health';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));
const endpoint = { namespace: 'istio-system', service: 'prometheus', port: '9090', basePath: '' };
const query: WorkloadHealthQuery = {
  kind: 'Deployment',
  namespace: 'bookinfo',
  name: 'reviews-v1',
  telemetryCluster: 'east',
  end: 10000,
};
const resource = {
  kind: 'Deployment',
  apiVersion: 'apps/v1',
  metadata: { name: 'reviews-v1', namespace: 'bookinfo' },
  spec: { replicas: 1 },
  status: { replicas: 1, availableReplicas: 1 },
};
const metric = {
  status: 'success',
  data: {
    resultType: 'vector',
    result: [
      { metric: { request_protocol: 'http', response_code: '503' }, value: [10000, '1'] },
      { metric: { request_protocol: 'http', response_code: '200' }, value: [10000, '99'] },
    ],
  },
};
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
  vi.mocked(ApiProxy.request).mockImplementation(async path =>
    String(path).startsWith('/apis/apps') ? resource : metric
  );
});
const load = (signal = new AbortController().signal) =>
  loadWorkloadHealth(clusterScope('alpha'), endpoint, query, [], signal);

it('combines both directions with replica state on one explicit cluster and captured time', async () => {
  const signal = new AbortController().signal;
  const snapshot = await load(signal);
  expect(snapshot.calculation).toMatchObject({
    status: 'Degraded',
    errorRatio: 1,
    totalRequestRate: 200,
  });
  expect(ApiProxy.request).toHaveBeenCalledTimes(3);
  for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
    expect(options).toMatchObject({ cluster: 'alpha', signal: expect.any(AbortSignal) });
    if (!String(path).startsWith('/apis/apps'))
      expect(new URL(String(path), 'http://example.test').searchParams.get('time')).toBe('10000');
  }
});
it.each(['forbidden', 'empty', 'warnings', 'non-finite', 'stale'])(
  'does not infer healthy status for %s data',
  async reason => {
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      if (String(path).startsWith('/apis/apps'))
        return reason === 'stale'
          ? {
              ...resource,
              metadata: { ...resource.metadata, generation: 2 },
              status: { ...resource.status, observedGeneration: 1 },
            }
          : resource;
      if (reason === 'forbidden') throw { status: 403, message: 'No metric access' };
      if (reason === 'empty') return { ...metric, data: { ...metric.data, result: [] } };
      if (reason === 'warnings') return { ...metric, warnings: ['partial data'] };
      if (reason === 'non-finite')
        return {
          ...metric,
          data: {
            ...metric.data,
            result: [
              { metric: { request_protocol: 'http', response_code: '200' }, value: [10000, 'NaN'] },
            ],
          },
        };
      return metric;
    });
    const result = await load();
    expect(result.calculation).toBeNull();
    if (reason === 'forbidden')
      expect(result.inbound).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
    if (reason === 'non-finite')
      expect(result.inbound).toMatchObject({ ok: false, error: { kind: 'invalid-response' } });
  }
);
it('applies custom cluster rules while retaining default fallthrough and annotation overrides', async () => {
  const rules = [
    {
      namespace: 'bookinfo',
      kind: 'workload',
      tolerance: [{ code: '5xx', degraded: 5, failure: 10, protocol: 'http', direction: '.*' }],
    },
  ];
  const result = await loadWorkloadHealth(
    clusterScope('alpha'),
    endpoint,
    query,
    rules,
    new AbortController().signal
  );
  expect(result.calculation?.status).toBe('Healthy');
});
it('stops aborted work instead of returning success-shaped empty data', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(load(controller.signal)).rejects.toThrow();
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
it('includes source-only inbound failures in explicit combined mode without summing both reporters', async () => {
  vi.mocked(ApiProxy.request).mockImplementation(async path => {
    if (String(path).startsWith('/apis/apps')) return resource;
    const expression = new URL(String(path), 'http://example.test').searchParams.get('query')!;
    const source = expression.includes('reporter="source"');
    const destination = expression.includes('reporter="destination"');
    return {
      status: 'success',
      data: {
        resultType: 'vector',
        result: [
          {
            metric: {
              request_protocol: 'http',
              response_code: '200',
              reporter: source ? 'source' : 'destination',
            },
            value: [10000, '100'],
          },
          ...(!source && !destination
            ? [
                {
                  metric: { request_protocol: 'http', response_code: '503', reporter: 'source' },
                  value: [10000, '20'],
                },
              ]
            : []),
        ],
      },
    };
  });
  expect((await load()).calculation?.status).toBe('Healthy');
  const combined = await loadWorkloadHealth(
    clusterScope('alpha'),
    endpoint,
    { ...query, reporterMode: 'combined' },
    [],
    new AbortController().signal
  );
  expect(combined.calculation).toMatchObject({ status: 'Failure', totalRequestRate: 220 });
  expect(combined.calculation?.errorRatio).toBeCloseTo(100 / 6);
});
it('suppresses combined health when a backend drops required reporter labels', async () => {
  const result = await loadWorkloadHealth(
    clusterScope('alpha'),
    endpoint,
    { ...query, reporterMode: 'combined' },
    [],
    new AbortController().signal
  );
  expect(result.calculation).toBeNull();
  expect(result.calculationError?.message).toContain('reporter labels');
});
