import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  ApplicationDashboardEvidence,
  applicationDashboardSelectors,
} from '../core/applicationDashboards';
import { ClusterConfig } from '../core/config';
import { DASHBOARD_ANNOTATION } from '../core/dashboardAnnotations';
import { inspectApplicationDashboards } from './applicationDashboards';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));
const ns = {
  kind: 'Namespace',
  apiVersion: 'v1',
  metadata: { name: 'bookinfo', uid: 'ns-uid', resourceVersion: '1' },
};
const evidence = (): ApplicationDashboardEvidence => ({
  cluster: 'alpha',
  namespace: 'bookinfo',
  application: 'reviews',
  complete: true,
  pods: [{ name: 'pod', uid: 'pod-uid', resourceVersion: '2', refs: [] }],
  refs: [],
  selectors: applicationDashboardSelectors('reviews'),
});
const settings = (): ClusterConfig => ({
  prometheus: { namespace: 'monitoring', service: 'prometheus', port: '9090', basePath: '' },
  customDashboards: {
    namespaceLabel: 'namespace',
    clusterLabel: 'cluster',
    dashboards: ['first', 'second'].map(name => ({
      name,
      title: name,
      runtime: 'shared',
      discoverOn: `${name}_info`,
      items: [{ chart: { name: 'Memory', metricName: 'memory_bytes', dataType: 'raw' } }],
    })),
  },
});
function vector(names: string[]) {
  return {
    status: 'success',
    data: {
      resultType: 'vector',
      result: names.map(name => ({
        metric: { __name__: name },
        value: [Math.floor(Date.now() / 1000), '1'],
      })),
    },
  };
}
const inspect = (input = evidence(), config = settings(), signal = new AbortController().signal) =>
  inspectApplicationDashboards(input, config, 'east', false, signal);
beforeEach(() => {
  vi.mocked(ApiProxy.request)
    .mockReset()
    .mockImplementation(async path => (path === '/api/v1/namespaces/bookinfo' ? ns : vector([])));
});
it('gives resolved references precedence even over disabled/incomplete fallback and captures before await', async () => {
  const input = evidence();
  input.refs = ['second', 'unknown'];
  input.complete = false;
  const config = settings();
  config.customDashboards!.discoveryMode = 'disabled';
  const pending = inspect(input, config);
  input.namespace = 'other';
  input.refs.length = 0;
  config.prometheus!.service = 'other';
  const result = await pending;
  expect(result).toMatchObject({
    mode: 'explicit',
    partial: true,
    refs: [{ name: 'second' }],
    unknown: ['unknown'],
  });
  expect(result.evidence.namespace).toBe('bookinfo');
  expect(result.settings.prometheus!.service).toBe('prometheus');
  expect(result.annotationSources[0].uid).toBe('ns-uid');
  expect(ApiProxy.request).toHaveBeenCalledTimes(1);
});
it('applies Namespace disable/override definitions before explicit resolution and discovery', async () => {
  vi.mocked(ApiProxy.request).mockResolvedValueOnce({
    ...ns,
    metadata: {
      ...ns.metadata,
      annotations: {
        [DASHBOARD_ANNOTATION]: JSON.stringify([
          { name: 'first' },
          {
            name: 'second',
            title: 'Namespace title',
            items: [{ chart: { name: 'C', metricName: 'overridden', dataType: 'raw' } }],
          },
        ]),
      },
    },
  });
  const result = await inspect({ ...evidence(), refs: ['first', 'second'] });
  expect(result.refs).toMatchObject([{ name: 'second', title: 'Namespace title' }]);
  expect(result.unknown).toEqual(['first']);
  expect(result.catalog.origins.get('second')).toBe('namespace');
  expect(ApiProxy.request).toHaveBeenCalledTimes(1);
});
it('tries default selectors sequentially and replaces, rather than unions, the runtime group', async () => {
  vi.mocked(ApiProxy.request)
    .mockResolvedValueOnce(ns)
    .mockResolvedValueOnce(vector(['first_info']))
    .mockResolvedValueOnce(vector(['first_info', 'second_info']))
    .mockResolvedValueOnce(vector(['second_info']));
  const result = await inspect({ ...evidence(), refs: ['unknown'] });
  expect(result.refs).toMatchObject([
    { name: 'second', selector: { metricLabel: 'app', filters: { app: 'reviews' } } },
  ]);
  expect(result.reads).toHaveLength(3);
  expect(result.mode).toBe('discovered');
  const paths = vi
    .mocked(ApiProxy.request)
    .mock.calls.slice(1)
    .map(([path]) => decodeURIComponent(path));
  expect(paths[0]).toContain('service_istio_io_canonical_name="reviews"');
  expect(paths[1]).toContain('app_kubernetes_io_name="reviews"');
  expect(paths[2]).toContain('app="reviews"');
  expect(
    paths.every(path => path.includes('namespace="bookinfo"') && path.includes('cluster="east"'))
  ).toBe(true);
});
it.each([
  ['incomplete', false, undefined, 1],
  ['disabled', true, 'disabled', 1],
  ['threshold', true, undefined, 11],
] as const)('defers %s without discovery requests', async (reason, complete, mode, count) => {
  const config = settings();
  config.customDashboards!.discoveryMode = mode;
  const input = evidence();
  input.complete = complete;
  input.pods = Array.from({ length: count }, (_, i) => ({
    name: `p${i}`,
    uid: `u${i}`,
    resourceVersion: '1',
    refs: [],
  }));
  expect(await inspect(input, config)).toMatchObject({ mode: 'deferred', reason, reads: [] });
  expect(ApiProxy.request).toHaveBeenCalledTimes(1);
});
it.each([
  ['auto', 10],
  ['enabled', 11],
] as const)('permits %s discovery for %i Pods', async (mode, count) => {
  const config = settings();
  config.customDashboards!.discoveryMode = mode;
  const input = evidence();
  input.pods = Array.from({ length: count }, (_, i) => ({
    name: `p${i}`,
    uid: `u${i}`,
    resourceVersion: '1',
    refs: [],
  }));
  expect((await inspect(input, config)).mode).toBe('discovered');
  expect(ApiProxy.request).toHaveBeenCalledTimes(4);
});
it('uses just the configured selector and reports invalid or protected mapped labels before metric transport', async () => {
  for (const label of ['1app', 'namespace', 'cluster']) {
    const input = evidence();
    input.selectors = applicationDashboardSelectors('reviews', { app: label, version: 'version' });
    const result = await inspect(input);
    expect(result.partial).toBe(true);
    expect(result.reads[0].read.ok).toBe(false);
  }
  expect(ApiProxy.request).toHaveBeenCalledTimes(3);
});
it('retains successful selector groups beside explicit provider failures', async () => {
  vi.mocked(ApiProxy.request)
    .mockResolvedValueOnce(ns)
    .mockResolvedValueOnce(vector(['first_info']))
    .mockRejectedValueOnce({ status: 403, message: 'denied' })
    .mockResolvedValueOnce(vector([]));
  const result = await inspect();
  expect(result.partial).toBe(true);
  expect(result.refs).toMatchObject([
    { name: 'first', selector: { metricLabel: 'service_istio_io_canonical_name' } },
  ]);
  expect(result.reads[1].read).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
});
it('never falls back after Namespace denial, and refuses already cancelled reads', async () => {
  vi.mocked(ApiProxy.request).mockRejectedValueOnce({ status: 403, message: 'denied' });
  await expect(inspect({ ...evidence(), refs: ['first'] })).rejects.toMatchObject({ status: 403 });
  const controller = new AbortController();
  controller.abort();
  await expect(inspect(evidence(), settings(), controller.signal)).rejects.toThrow();
  expect(ApiProxy.request).toHaveBeenCalledTimes(1);
});
it('applies workload annotations after Namespace sources while verifying the captured UID/version', async () => {
  const input = evidence();
  input.refs = ['first'];
  input.workload = {
    kind: 'Deployment',
    name: 'reviews',
    uid: 'dep-uid',
    resourceVersion: '17',
    version: 'v1',
  };
  const workload = {
    kind: 'Deployment',
    apiVersion: 'apps/v1',
    metadata: { name: 'reviews', namespace: 'bookinfo', uid: 'dep-uid', resourceVersion: '17' },
    spec: {
      template: {
        metadata: {
          annotations: {
            [DASHBOARD_ANNOTATION]: JSON.stringify([
              {
                name: 'first',
                title: 'Workload override',
                items: [{ chart: { name: 'C', metricName: 'workload_metric', dataType: 'raw' } }],
              },
            ]),
          },
        },
      },
    },
  };
  vi.mocked(ApiProxy.request).mockResolvedValueOnce(ns).mockResolvedValueOnce(workload);
  const result = await inspect(input);
  expect(result.refs).toMatchObject([{ title: 'Workload override' }]);
  expect(result.catalog.origins.get('first')).toBe('workload');
  expect(vi.mocked(ApiProxy.request).mock.calls.map(([path]) => path)).toEqual([
    '/api/v1/namespaces/bookinfo',
    '/apis/apps/v1/namespaces/bookinfo/deployments/reviews',
  ]);
  for (const metadata of [
    { ...workload.metadata, uid: 'replacement' },
    { ...workload.metadata, resourceVersion: '18' },
  ]) {
    vi.mocked(ApiProxy.request)
      .mockReset()
      .mockResolvedValueOnce(ns)
      .mockResolvedValueOnce({ ...workload, metadata });
    await expect(inspect(input)).rejects.toThrow('changed since its ownership snapshot');
    expect(ApiProxy.request).toHaveBeenCalledTimes(2);
  }
});
it('preserves captured workload version constraints throughout metric discovery', async () => {
  const input = evidence();
  input.workload = {
    kind: 'Pod',
    name: 'reviews',
    uid: 'pod-uid',
    resourceVersion: '17',
    version: 'v1',
  };
  input.selectors = [
    {
      label: 'app',
      metricLabel: 'app',
      versionLabel: 'version',
      metricVersionLabel: 'version',
      filters: { app: 'reviews', version: 'v1' },
    },
  ];
  vi.mocked(ApiProxy.request)
    .mockResolvedValueOnce(ns)
    .mockResolvedValueOnce({
      kind: 'Pod',
      apiVersion: 'v1',
      metadata: { name: 'reviews', namespace: 'bookinfo', uid: 'pod-uid', resourceVersion: '17' },
    })
    .mockResolvedValueOnce(vector(['first_info']));
  const result = await inspect(input);
  expect(result.refs[0].selector?.filters).toEqual({ app: 'reviews', version: 'v1' });
  expect(decodeURIComponent(vi.mocked(ApiProxy.request).mock.calls[2][0])).toContain(
    'version="v1"'
  );
});
it('enforces one whole-inspection deadline even when a later selector ignores abort', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(ApiProxy.request)
      .mockResolvedValueOnce(ns)
      .mockImplementationOnce(
        () => new Promise(resolve => setTimeout(() => resolve(vector(['first_info'])), 10000))
      )
      .mockImplementationOnce(() => new Promise(() => {}));
    const pending = inspect();
    const failure = expect(pending).rejects.toThrow(
      'Application dashboard inspection exceeded 15 seconds'
    );
    await vi.advanceTimersByTimeAsync(15000);
    await failure;
    expect(ApiProxy.request).toHaveBeenCalledTimes(3);
    expect(vi.mocked(ApiProxy.request).mock.calls[2][1]?.signal?.aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
