import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { CustomDashboardSettings } from '../core/customDashboards';
import { DASHBOARD_ANNOTATION, DashboardAnnotationTarget } from '../core/dashboardAnnotations';
import { loadDashboardAnnotations } from './dashboardAnnotations';
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request: vi.fn() } }));
const settings = (): CustomDashboardSettings => ({
  namespaceLabel: 'namespace',
  clusterLabel: 'cluster',
  includeBuiltins: true,
  dashboards: [],
});
const declaration = (metric: string) =>
  JSON.stringify([
    {
      name: 'go',
      title: 'Overridden Go',
      items: [{ chart: { name: 'C', metricName: metric, dataType: 'raw' } }],
    },
  ]);
const ns = {
  kind: 'Namespace',
  apiVersion: 'v1',
  metadata: {
    name: 'bookinfo',
    uid: 'ns-uid',
    resourceVersion: '1',
    annotations: { [DASHBOARD_ANNOTATION]: declaration('namespace_metric') },
  },
};
const deployment = {
  kind: 'Deployment',
  apiVersion: 'apps/v1',
  metadata: { name: 'reviews', namespace: 'bookinfo', uid: 'dep-uid', resourceVersion: '2' },
  spec: {
    template: {
      metadata: { annotations: { [DASHBOARD_ANNOTATION]: declaration('workload_metric') } },
    },
  },
};
beforeEach(() => {
  vi.mocked(ApiProxy.request).mockReset();
});
it('captures target/base scope before reading namespace then workload with immutable provenance', async () => {
  vi.mocked(ApiProxy.request).mockResolvedValueOnce(ns).mockResolvedValueOnce(deployment);
  const scope = { cluster: 'alpha' };
  const base = settings();
  const target: DashboardAnnotationTarget = {
    namespace: 'bookinfo',
    workload: { kind: 'Deployment', name: 'reviews' },
  };
  const pending = loadDashboardAnnotations(scope, base, target, new AbortController().signal);
  scope.cluster = 'other';
  target.namespace = 'other';
  base.includeBuiltins = false;
  const result = await pending;
  expect(result.cluster).toBe('alpha');
  expect(result.target.namespace).toBe('bookinfo');
  expect(result.catalog.origins.get('go')).toBe('workload');
  expect(
    result.catalog.templates.find(template => template.name === 'go')?.items[0].chart?.metricName
  ).toBe('workload_metric');
  expect(result.sources.map(source => source.uid)).toEqual(['ns-uid', 'dep-uid']);
  expect(vi.mocked(ApiProxy.request).mock.calls.map(([path]) => path)).toEqual([
    '/api/v1/namespaces/bookinfo',
    '/apis/apps/v1/namespaces/bookinfo/deployments/reviews',
  ]);
  expect(
    vi.mocked(ApiProxy.request).mock.calls.every(([, options]) => options?.cluster === 'alpha')
  ).toBe(true);
});
it('fails closed on namespace denial, malformed YAML or a later workload failure', async () => {
  const target: DashboardAnnotationTarget = {
    namespace: 'bookinfo',
    workload: { kind: 'Deployment', name: 'reviews' },
  };
  vi.mocked(ApiProxy.request).mockRejectedValueOnce({ status: 403, message: 'denied' });
  await expect(
    loadDashboardAnnotations({ cluster: 'alpha' }, settings(), target, new AbortController().signal)
  ).rejects.toMatchObject({ status: 403 });
  expect(ApiProxy.request).toHaveBeenCalledTimes(1);
  vi.mocked(ApiProxy.request)
    .mockReset()
    .mockResolvedValueOnce(ns)
    .mockRejectedValueOnce({ status: 404, message: 'gone' });
  await expect(
    loadDashboardAnnotations({ cluster: 'alpha' }, settings(), target, new AbortController().signal)
  ).rejects.toMatchObject({ status: 404 });
  vi.mocked(ApiProxy.request)
    .mockReset()
    .mockResolvedValueOnce({
      ...ns,
      metadata: { ...ns.metadata, annotations: { [DASHBOARD_ANNOTATION]: 'secret: [' } },
    });
  await expect(
    loadDashboardAnnotations({ cluster: 'alpha' }, settings(), target, new AbortController().signal)
  ).rejects.toThrow('Invalid dashboard annotation YAML');
  expect(ApiProxy.request).toHaveBeenCalledTimes(1);
});
it('shares a fifteen-second deadline across reads and cancels transports that ignore abort', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(ApiProxy.request).mockImplementation(() => new Promise(() => {}));
    const pending = loadDashboardAnnotations(
      { cluster: 'alpha' },
      settings(),
      { namespace: 'bookinfo' },
      new AbortController().signal
    );
    const failure = expect(pending).rejects.toThrow(
      'Dashboard annotation reads exceeded 15 seconds'
    );
    await vi.advanceTimersByTimeAsync(15000);
    await failure;
    expect(vi.mocked(ApiProxy.request).mock.calls[0][1]?.signal?.aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
