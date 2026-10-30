import { CORRELATION_SOURCES, decodeCorrelationResource } from '../data/correlation';
import {
  applicationDashboardSelectors,
  captureApplicationDashboardEvidence,
  explicitApplicationDashboards,
  observedPodDashboardReferences,
} from './applicationDashboards';
import { correlateResources } from './correlation';
import { validateCustomDashboardSettings } from './customDashboards';
import { effectiveDashboardCatalog } from './dashboardCatalog';
import { namespaceScope } from './scope';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: vi.fn() },
  K8s: { cluster: { KubeObject: class {} } },
}));
function application() {
  const pod = decodeCorrelationResource(
    {
      kind: 'Pod',
      apiVersion: 'v1',
      metadata: {
        name: 'reviews',
        namespace: 'bookinfo',
        uid: 'pod-1',
        resourceVersion: '17',
        labels: { app: 'reviews' },
        annotations: { 'kiali.io/runtimes': 'go, missing' },
      },
      spec: { containers: [{ name: 'app' }] },
    },
    CORRELATION_SOURCES.find(source => source.kind === 'Pod')!,
    namespaceScope('alpha', 'bookinfo')
  );
  return correlateResources([pod]).applications[0];
}

it('captures ordered runtime then dashboard references with Go whitespace and stable deduplication', () => {
  expect(
    observedPodDashboardReferences({
      'kiali.io/runtimes': ' \u0085go, java,go,,',
      'kiali.io/dashboards': 'custom,java,other',
      unrelated: 42,
    })
  ).toEqual({ ok: true, refs: ['go', 'java', 'custom', 'other'], bytes: 33 });
  expect(observedPodDashboardReferences({})).toEqual({ ok: true, refs: [], bytes: 0 });
  expect(observedPodDashboardReferences(undefined)).toEqual({ ok: true, refs: [], bytes: 0 });
});
it.each(
  [
    [],
    'bad',
    { 'kiali.io/runtimes': null },
    { 'kiali.io/dashboards': 42 },
    { 'kiali.io/runtimes': '\uFEFFgo' },
    { 'kiali.io/runtimes': 'a b' },
    { 'kiali.io/runtimes': 'x'.repeat(129) },
    { 'kiali.io/runtimes': ' '.repeat(4097) },
    { 'kiali.io/runtimes': '\u0085'.repeat(2049) },
    { 'kiali.io/runtimes': Array.from({ length: 65 }, (_, i) => `n${i}`).join(',') },
  ].map(input => ({ input }))
)('retains invalid annotation evidence as an error: $input', ({ input }) => {
  expect(observedPodDashboardReferences(input).ok).toBe(false);
});
it('uses the pinned app-label order or the full custom pair, without adding a version filter', () => {
  expect(applicationDashboardSelectors('reviews').map(selector => selector.metricLabel)).toEqual([
    'service_istio_io_canonical_name',
    'app_kubernetes_io_name',
    'app',
  ]);
  expect(
    applicationDashboardSelectors('reviews', { app: 'example.io/app', version: 'version' })
  ).toEqual([
    {
      label: 'example.io/app',
      metricLabel: 'example_io_app',
      filters: { example_io_app: 'reviews' },
    },
  ]);
  expect(() => applicationDashboardSelectors('')).toThrow('nonempty');
});
it('captures immutable, UID-attributed Pod evidence and resolves explicit references without discovery', () => {
  const app = application();
  const evidence = captureApplicationDashboardEvidence(app, false);
  app.pods[0].resourceVersion = 'later';
  app.pods[0].dashboardRefs = observedPodDashboardReferences({});
  expect(evidence.pods[0]).toEqual({
    name: 'reviews',
    uid: 'pod-1',
    resourceVersion: '17',
    refs: ['go', 'missing'],
  });
  expect(evidence.complete).toBe(false);
  const catalog = effectiveDashboardCatalog({
    namespaceLabel: 'namespace',
    clusterLabel: 'cluster',
    includeBuiltins: true,
    dashboards: [],
  });
  expect(explicitApplicationDashboards(evidence, catalog)).toMatchObject({
    refs: [{ name: 'go' }],
    unknown: ['missing'],
  });
});
it.each([
  (app: ReturnType<typeof application>) => {
    app.pods[0].resourceVersion = ' ';
  },
  (app: ReturnType<typeof application>) => {
    app.pods[0].identity.uid = ' wrong ';
  },
  (app: ReturnType<typeof application>) => {
    app.pods[0].identity.namespace = 'other';
  },
  (app: ReturnType<typeof application>) => {
    app.pods[0].dashboardRefs = undefined;
  },
  (app: ReturnType<typeof application>) => {
    app.pods[0].dashboardRefs = { ok: false, message: 'bad refs' };
  },
  (app: ReturnType<typeof application>) => {
    app.pods.push(app.pods[0]);
  },
  (app: ReturnType<typeof application>) => {
    app.pods = [];
  },
  (app: ReturnType<typeof application>) => {
    app.workloads = [];
  },
  (app: ReturnType<typeof application>) => {
    app.workloads[0].app = { key: 'app', value: 'other' };
  },
  (app: ReturnType<typeof application>) => {
    app.workloads[0].pods = [];
  },
])('rejects missing, invalid or inconsistent evidence (%#)', mutate => {
  const app = application();
  mutate(app);
  expect(() => captureApplicationDashboardEvidence(app, true)).toThrow();
});
it('enforces the total UTF-8 reference budget independently of unique-name count', () => {
  const app = application();
  app.pods[0].dashboardRefs = observedPodDashboardReferences({
    'kiali.io/runtimes': '\u0085'.repeat(2000),
  });
  app.pods = Array.from({ length: 17 }, (_, i) => ({
    ...structuredClone(app.pods[0]),
    identity: { ...app.pods[0].identity, name: `p${i}`, uid: `u${i}` },
  }));
  app.workloads[0].pods = app.pods;
  expect(() => captureApplicationDashboardEvidence(app, true)).toThrow('64 KiB');
});
it.each(['auto', 'enabled', 'disabled'])(
  'preserves an explicit %s policy and zero threshold',
  discoveryMode => {
    const settings = {
      namespaceLabel: 'namespace',
      clusterLabel: 'cluster',
      dashboards: [],
      discoveryMode,
      discoveryAutoThreshold: 0,
    };
    expect(validateCustomDashboardSettings(settings)).toEqual(settings);
  }
);
it.each([
  { discoveryMode: null },
  { discoveryMode: 'yes' },
  { discoveryMode: true },
  { discoveryAutoThreshold: null },
  { discoveryAutoThreshold: -1 },
  { discoveryAutoThreshold: 1001 },
  { discoveryAutoThreshold: 1.1 },
  { discoveryAutoThreshold: '10' },
])('rejects invalid discovery settings %j', fields => {
  expect(() =>
    validateCustomDashboardSettings({
      namespaceLabel: 'namespace',
      clusterLabel: 'cluster',
      dashboards: [],
      ...fields,
    })
  ).toThrow('Application dashboard');
});
