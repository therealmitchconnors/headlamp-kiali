import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { EntityHealthQuery } from '../core/entityHealth';
import { HealthRateRule } from '../core/healthCalculator';
import { WorkloadHealthQuery } from '../core/workloadHealth';
import { CORRELATION_SOURCES } from './correlation';
import { loadEntityHealth } from './entityHealth';
import { loadWorkloadHealth } from './health';
import { loadTelemetry } from './telemetry';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
const endpoint = { namespace: 'monitoring', service: 'prometheus', port: '9090', basePath: '' };
const scope = { cluster: 'alpha' };
const workload: WorkloadHealthQuery = {
  kind: 'Deployment',
  namespace: 'bookinfo',
  name: 'reviews',
  telemetryCluster: 'mesh-east',
  end: 10000,
};
const entity: EntityHealthQuery = {
  kind: 'Application',
  namespace: 'bookinfo',
  name: 'reviews',
  telemetryApp: 'reviews',
  telemetryCluster: 'mesh-east',
  end: 10000,
};
const traffic = {
  namespace: 'bookinfo',
  telemetryCluster: 'mesh-east',
  direction: 'inbound' as const,
  minutes: 15 as const,
  end: 10000,
};
const deployment = {
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: {
    name: 'reviews',
    namespace: 'bookinfo',
    uid: 'deployment-uid',
    resourceVersion: '1',
    generation: 1,
  },
  spec: { replicas: 1, template: { metadata: { labels: { app: 'reviews', version: 'v1' } } } },
  status: { observedGeneration: 1, replicas: 1, availableReplicas: 1 },
};
function response(path: string) {
  if (path === '/apis/networking.istio.io') throw { status: 404, message: 'Not served' };
  const url = new URL(path, 'http://example.test');
  if (url.pathname.includes('/proxy/'))
    return {
      status: 'success',
      data: { resultType: url.pathname.endsWith('/query') ? 'vector' : 'matrix', result: [] },
    };
  if (url.pathname.endsWith('/deployments/reviews')) return deployment;
  if (url.pathname.endsWith('/services/reviews'))
    return {
      kind: 'Service',
      apiVersion: 'v1',
      metadata: { name: 'reviews', namespace: 'bookinfo', uid: 'service-uid' },
      spec: {},
    };
  const source = CORRELATION_SOURCES.find(source => url.pathname.endsWith(`/${source.plural}`));
  if (!source) throw new Error('Unexpected request');
  return {
    apiVersion: source.apiVersion,
    kind: `${source.kind}List`,
    metadata: { resourceVersion: '1' },
    items: source.kind === 'Deployment' ? [deployment] : [],
  };
}
beforeEach(() => {
  vi.mocked(ApiProxy.request)
    .mockReset()
    .mockImplementation(async path => response(String(path)));
});
it('captures every metrics batch and returned query before caller mutation', async () => {
  const query = { ...traffic };
  const selected = { ...scope };
  const provider = { ...endpoint };
  const pending = loadTelemetry(selected, provider, query, new AbortController().signal);
  selected.cluster = 'other';
  provider.service = 'other';
  query.telemetryCluster = 'other';
  query.end = 20000;
  const result = await pending;
  expect(result.query).toEqual(traffic);
  expect(vi.mocked(ApiProxy.request).mock.calls).toHaveLength(5);
  for (const [path, options] of vi.mocked(ApiProxy.request).mock.calls) {
    expect(options?.cluster).toBe('alpha');
    expect(String(path)).toContain('/services/prometheus:9090/');
    const url = new URL(String(path), 'http://example.test');
    expect(url.searchParams.get('query')).toContain('cluster="mesh-east"');
    expect(url.searchParams.get('time') ?? url.searchParams.get('end')).toBe('10000');
  }
});
it('captures workload health configuration and query inputs before deferred reads', async () => {
  const query = { ...workload };
  const selected = { ...scope };
  const provider = { ...endpoint };
  const rules: HealthRateRule[] = [];
  const pending = loadWorkloadHealth(
    selected,
    provider,
    query,
    rules,
    new AbortController().signal
  );
  query.name = 'other';
  query.end = 20000;
  selected.cluster = 'other';
  provider.service = 'other';
  rules.push({ namespace: '[', kind: 'workload', name: 'reviews', tolerance: [] });
  const result = await pending;
  expect(result.query).toEqual(workload);
  expect(
    vi
      .mocked(ApiProxy.request)
      .mock.calls.every(
        ([path, options]) => !String(path).includes('other') && options?.cluster === 'alpha'
      )
  ).toBe(true);
});
it('captures application labels and later metric requests after the resource inventory', async () => {
  const query = { ...entity };
  const selected = { ...scope };
  const provider = { ...endpoint };
  const labels = { app: 'app', version: 'version' };
  const pending = loadEntityHealth(
    selected,
    provider,
    query,
    [],
    labels,
    new AbortController().signal
  );
  labels.app = 'missing';
  query.name = 'other';
  query.end = 20000;
  selected.cluster = 'other';
  provider.service = 'other';
  const result = await pending;
  expect(result.query).toEqual(entity);
  expect(result.application?.name).toBe('reviews');
  expect(vi.mocked(ApiProxy.request).mock.calls).toHaveLength(12);
  const signal = vi.mocked(ApiProxy.request).mock.calls[0][1]?.signal;
  expect(signal?.aborted).toBe(true);
  expect(
    vi
      .mocked(ApiProxy.request)
      .mock.calls.every(
        ([path, options]) =>
          !String(path).includes('other') &&
          options?.cluster === 'alpha' &&
          options?.signal?.aborted
      )
  ).toBe(true);
});
const readers = [
  {
    name: 'traffic',
    load: (signal: AbortSignal) => loadTelemetry(scope, endpoint, traffic, signal),
  },
  {
    name: 'workload',
    load: (signal: AbortSignal) => loadWorkloadHealth(scope, endpoint, workload, [], signal),
  },
  {
    name: 'application',
    load: (signal: AbortSignal) => loadEntityHealth(scope, endpoint, entity, [], null, signal),
  },
  {
    name: 'service',
    load: (signal: AbortSignal) =>
      loadEntityHealth(scope, endpoint, { ...entity, kind: 'Service' }, [], null, signal),
  },
];
it.each(readers)(
  'times out a hung $name read without returning a successful empty snapshot',
  async ({ load }) => {
    vi.useFakeTimers();
    try {
      vi.mocked(ApiProxy.request).mockImplementation(() => new Promise(() => {}));
      const pending = load(new AbortController().signal);
      const rejected = expect(pending).rejects.toThrow('15 seconds');
      await vi.advanceTimersByTimeAsync(15000);
      await rejected;
      expect(vi.mocked(ApiProxy.request).mock.calls.length).toBeLessThanOrEqual(3);
      expect(
        vi.mocked(ApiProxy.request).mock.calls.every(([, options]) => options?.signal?.aborted)
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  }
);
