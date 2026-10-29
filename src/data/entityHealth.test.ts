import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { EntityHealthQuery } from '../core/entityHealth';
import { clusterScope } from '../core/scope';
import { CORRELATION_SOURCES } from './correlation';
import { loadEntityHealth } from './entityHealth';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
const endpoint = { namespace: 'istio-system', service: 'prometheus', port: '9090', basePath: '' };
const appQuery: EntityHealthQuery = {
  kind: 'Application',
  namespace: 'bookinfo',
  name: 'reviews',
  telemetryApp: 'telemetry-reviews',
  telemetryCluster: 'east',
  end: 10000,
};
const serviceQuery: EntityHealthQuery = {
  kind: 'Service',
  namespace: 'bookinfo',
  name: 'reviews',
  telemetryCluster: 'east',
  end: 10000,
};
const service = {
  kind: 'Service',
  apiVersion: 'v1',
  metadata: { name: 'reviews', namespace: 'bookinfo' },
  spec: {},
};
const metric = {
  status: 'success',
  data: {
    resultType: 'vector',
    result: [
      { metric: { request_protocol: 'http', response_code: '200' }, value: [10000, '99'] },
      { metric: { request_protocol: 'http', response_code: '503' }, value: [10000, '1'] },
    ],
  },
};
function response(path: string, degraded = false, annotations: unknown = undefined) {
  if (path === '/apis/networking.istio.io') throw { status: 404, message: 'Not served' };
  if (path.includes('/proxy/')) return metric;
  if (path === '/api/v1/namespaces/bookinfo/services/reviews') return service;
  const source = CORRELATION_SOURCES.find(source => path.includes(`/${source.plural}?`));
  if (!source) throw new Error(`Unexpected request ${path}`);
  return {
    kind: `${source.kind}List`,
    apiVersion: source.apiVersion,
    metadata: { resourceVersion: '1' },
    items:
      source.kind === 'Deployment'
        ? [1, 2].map(version => ({
            metadata: {
              name: `reviews-v${version}`,
              namespace: 'bookinfo',
              uid: `v${version}`,
              generation: 1,
            },
            spec: {
              replicas: 1,
              template: {
                metadata: { labels: { app: 'reviews', version: `v${version}` }, annotations },
              },
            },
            status: {
              observedGeneration: 1,
              replicas: 1,
              availableReplicas: degraded && version === 2 ? 0 : 1,
            },
          }))
        : [],
  };
}
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
  vi.mocked(ApiProxy.request).mockImplementation(async path => response(String(path)));
});
const load = (query: EntityHealthQuery = appQuery, signal = new AbortController().signal) =>
  loadEntityHealth(clusterScope('alpha'), endpoint, query, [], null, signal);

it('reuses one namespace snapshot, combines app controllers and requests explicit canonical metrics', async () => {
  const signal = new AbortController().signal;
  const result = await load(appQuery, signal);
  expect(result.issues).toEqual([]);
  expect(result.application?.workloads).toHaveLength(2);
  expect(result.calculation).toMatchObject({
    status: 'Degraded',
    totalRequestRate: 200,
    errorRatio: 1,
  });
  const calls = vi.mocked(ApiProxy.request).mock.calls;
  expect(calls).toHaveLength(12);
  const requests = calls.filter(([path]) => String(path).includes('/proxy/'));
  expect(requests).toHaveLength(2);
  for (const [path, options] of calls) {
    expect(options).toMatchObject({ cluster: 'alpha', signal: expect.any(AbortSignal) });
    expect(options?.method).toBeUndefined();
    if (String(path).includes('/proxy/')) {
      const url = new URL(String(path), 'http://example.test');
      expect(url.searchParams.get('query')).toContain('canonical_service="telemetry-reviews"');
      expect(url.searchParams.get('time')).toBe('10000');
    }
  }
});
it('merges application replica failures without applying individual workload rate annotations to the app', async () => {
  vi.mocked(ApiProxy.request).mockImplementation(async path =>
    response(String(path), true, { 'health.kiali.io/rate': '5xx,99,100,http,.*' })
  );
  expect((await load()).calculation?.status).toBe('Failure');
  vi.mocked(ApiProxy.request).mockImplementation(async path =>
    response(String(path), false, { 'health.kiali.io/rate': '5xx,99,100,http,.*' })
  );
  expect((await load()).calculation?.status).toBe('Degraded');
});
it('calculates only inbound Service requests and honors the Service health annotation', async () => {
  vi.mocked(ApiProxy.request).mockImplementation(async path =>
    String(path).includes('/proxy/')
      ? metric
      : {
          ...service,
          metadata: {
            ...service.metadata,
            annotations: { 'health.kiali.io/rate': '5xx,5,10,http,inbound' },
          },
        }
  );
  const result = await load(serviceQuery);
  expect(result.calculation).toMatchObject({ status: 'Healthy', totalRequestRate: 100 });
  expect(result.outbound).toBeUndefined();
  expect(ApiProxy.request).toHaveBeenCalledTimes(2);
});
it.each(['partial', 'stale', 'invalid-health', 'absent-app'])(
  'retains %s application evidence without fetching misleading metrics',
  async mode => {
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      if (mode === 'partial' && String(path).includes('/jobs?'))
        throw { status: 403, message: 'Jobs denied' };
      const result = response(
        String(path),
        false,
        mode === 'invalid-health' ? { bad: 3 } : undefined
      );
      if ('items' in result && result.items.length) {
        if (mode === 'stale') result.items[0].status.observedGeneration = 0;
        if (mode === 'absent-app') result.items = [];
      }
      return result;
    });
    const result = await load();
    expect(result.calculation).toBeNull();
    expect(result.issues.length).toBeGreaterThan(0);
    expect(
      vi.mocked(ApiProxy.request).mock.calls.every(([path]) => !String(path).includes('/proxy/'))
    ).toBe(true);
  }
);
it.each(['warnings', 'empty', 'stale-metric', 'duplicate'])(
  'does not infer health from %s metrics',
  async mode => {
    vi.mocked(ApiProxy.request).mockImplementation(async path => {
      if (!String(path).includes('/proxy/')) return service;
      if (mode === 'warnings') return { ...metric, warnings: ['partial backend results'] };
      if (mode === 'empty') return { ...metric, data: { ...metric.data, result: [] } };
      if (mode === 'duplicate')
        return {
          ...metric,
          data: { ...metric.data, result: [metric.data.result[0], metric.data.result[0]] },
        };
      return {
        ...metric,
        data: { ...metric.data, result: [{ ...metric.data.result[0], value: [9990, '1'] }] },
      };
    });
    const result = await load(serviceQuery);
    expect(result.calculation).toBeNull();
    if (mode === 'stale-metric' || mode === 'duplicate')
      expect(result.inbound).toMatchObject({ ok: false, error: { kind: 'invalid-response' } });
  }
);
it('combines both inbound reporters for Services without double-counting requests', async () => {
  vi.mocked(ApiProxy.request).mockImplementation(async path =>
    !String(path).includes('/proxy/')
      ? service
      : {
          status: 'success',
          data: {
            resultType: 'vector',
            result: [
              {
                metric: { reporter: 'source', request_protocol: 'http', response_code: '200' },
                value: [10000, '100'],
              },
              {
                metric: { reporter: 'destination', request_protocol: 'http', response_code: '200' },
                value: [10000, '90'],
              },
              {
                metric: { reporter: 'destination', request_protocol: 'http', response_code: '503' },
                value: [10000, '20'],
              },
            ],
          },
        }
  );
  const result = await load({ ...serviceQuery, reporterMode: 'combined' });
  expect(result.calculation).toMatchObject({ status: 'Failure', totalRequestRate: 120 });
  expect(result.outbound).toBeUndefined();
  const expression = new URL(
    String(vi.mocked(ApiProxy.request).mock.calls[1][0]),
    'http://example.test'
  ).searchParams.get('query');
  expect(expression).toContain('sum by (reporter,');
  expect(expression).not.toContain('reporter=');
});
it('does not read metrics after denied Service access or send requests after abort', async () => {
  vi.mocked(ApiProxy.request).mockRejectedValue({ status: 403, message: 'Service denied' });
  expect((await load(serviceQuery)).resourceError?.kind).toBe('forbidden');
  expect(ApiProxy.request).toHaveBeenCalledTimes(1);
  vi.mocked(ApiProxy.request).mockClear();
  const controller = new AbortController();
  controller.abort();
  await expect(load(serviceQuery, controller.signal)).rejects.toThrow();
  expect(ApiProxy.request).not.toHaveBeenCalled();
});
