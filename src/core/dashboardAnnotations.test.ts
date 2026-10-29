import {
  applyDashboardAnnotationLayer,
  DASHBOARD_ANNOTATION,
  DASHBOARD_WORKLOAD_KINDS,
  dashboardAnnotationEvidence,
  dashboardAnnotationPath,
  DashboardWorkloadKind,
  parseDashboardAnnotation,
} from './dashboardAnnotations';
import { effectiveDashboardCatalog } from './dashboardCatalog';

const yaml = (name = 'go', metricName = 'custom_metric') =>
  JSON.stringify([
    {
      name,
      title: name,
      items: [{ chart: { name: 'C', metricName, dataType: 'raw' } }],
    },
  ]);
const namespace = (annotations: unknown = {}) => ({
  kind: 'Namespace',
  apiVersion: 'v1',
  metadata: { name: 'bookinfo', uid: 'ns-uid', resourceVersion: '1', annotations },
});
const workload = (
  kind: DashboardWorkloadKind,
  annotations: unknown,
  templateAnnotations: unknown
) => ({
  kind,
  apiVersion: DASHBOARD_WORKLOAD_KINDS[kind].apiVersion,
  metadata: {
    name: 'target',
    namespace: 'bookinfo',
    uid: 'workload-uid',
    resourceVersion: '2',
    annotations,
  },
  spec: { template: { metadata: { annotations: templateAnnotations } } },
});
it('parses bounded YAML/JSON declarations without exposing parser source excerpts', () => {
  expect(parseDashboardAnnotation('- name: go\n  items: []')[0]).toMatchObject({
    name: 'go',
    items: [],
  });
  expect(parseDashboardAnnotation(yaml())).toHaveLength(1);
  expect(parseDashboardAnnotation('[]')).toEqual([]);
  expect(parseDashboardAnnotation('[] #' + 'x'.repeat(65532))).toEqual([]);
  expect(() => parseDashboardAnnotation('[] #' + 'x'.repeat(65533))).toThrow('64 KiB');
  expect(() => parseDashboardAnnotation('[] #' + '\u00e9'.repeat(32767))).toThrow('64 KiB');
  try {
    parseDashboardAnnotation('secret-value: [');
    throw new Error('Expected parse failure');
  } catch (error) {
    expect(String(error)).toContain('Invalid dashboard annotation YAML');
    expect(String(error)).not.toContain('secret-value');
  }
});
it.each(['', 'null', '{}', '&loop [*loop]', '- &item {name: go}\n- *item', '[[]', 'a: 1\na: 2'])(
  'rejects ambiguous, aliased or malformed YAML %#',
  value => {
    expect(() => parseDashboardAnnotation(value)).toThrow();
  }
);
it('bounds declaration count and structural complexity before normalization', () => {
  expect(() =>
    parseDashboardAnnotation(
      JSON.stringify(Array.from({ length: 21 }, (_, i) => ({ name: `d${i}` })))
    )
  ).toThrow('20');
  expect(() => parseDashboardAnnotation('['.repeat(18) + '0' + ']'.repeat(18))).toThrow(
    'complexity'
  );
  expect(() => parseDashboardAnnotation('[' + Array(8192).fill('0').join(',') + ']')).toThrow(
    'complexity'
  );
});
it('captures namespace identity, distinguishes missing and empty annotations and rejects wrong scope', () => {
  const missing = dashboardAnnotationEvidence(namespace(), { namespace: 'bookinfo' });
  expect(missing.source).toMatchObject({
    uid: 'ns-uid',
    resourceVersion: '1',
    annotationPresent: false,
    location: 'resource',
  });
  const empty = dashboardAnnotationEvidence(namespace({ [DASHBOARD_ANNOTATION]: '[]' }), {
    namespace: 'bookinfo',
  });
  expect(empty.source.annotationPresent).toBe(true);
  expect(empty.templates).toEqual([]);
  expect(() => dashboardAnnotationEvidence(namespace(), { namespace: 'other' })).toThrow(
    'identity and scope'
  );
  const bad = namespace();
  bad.metadata.uid = '';
  expect(() => dashboardAnnotationEvidence(bad, { namespace: 'bookinfo' })).toThrow('uid');
  expect(() =>
    dashboardAnnotationEvidence(namespace({ [DASHBOARD_ANNOTATION]: 1 }), { namespace: 'bookinfo' })
  ).toThrow('YAML string');
});
it.each(['Deployment', 'DaemonSet', 'StatefulSet', 'ReplicaSet', 'ReplicationController'] as const)(
  'preserves pinned %s pod-template map precedence, including an explicit empty map',
  kind => {
    const target = { namespace: 'bookinfo', workload: { kind, name: 'target' } };
    const own = { [DASHBOARD_ANNOTATION]: yaml('own') };
    expect(
      dashboardAnnotationEvidence(workload(kind, own, undefined), target).templates[0].name
    ).toBe('own');
    expect(dashboardAnnotationEvidence(workload(kind, own, null), target).source.location).toBe(
      'resource'
    );
    const masked = dashboardAnnotationEvidence(workload(kind, own, {}), target);
    expect(masked.templates).toEqual([]);
    expect(masked.source).toMatchObject({ location: 'pod-template', annotationPresent: false });
    expect(
      dashboardAnnotationEvidence(
        workload(kind, own, { [DASHBOARD_ANNOTATION]: yaml('template') }),
        target
      ).templates[0].name
    ).toBe('template');
  }
);
it.each(['Pod', 'Job', 'CronJob'] as const)(
  'uses %s own metadata rather than a guessed template',
  kind => {
    const value = workload(
      kind,
      { [DASHBOARD_ANNOTATION]: yaml('own') },
      { [DASHBOARD_ANNOTATION]: yaml('ignored') }
    );
    const result = dashboardAnnotationEvidence(value, {
      namespace: 'bookinfo',
      workload: { kind, name: 'target' },
    });
    expect(result.source.location).toBe('resource');
    expect(result.templates[0].name).toBe('own');
  }
);
it('applies later layers by name, including same-layer duplicates, disable and re-enable', () => {
  const base = effectiveDashboardCatalog({
    namespaceLabel: 'namespace',
    clusterLabel: 'cluster',
    includeBuiltins: true,
    dashboards: [],
  });
  const snapshot = structuredClone(base);
  const ns = applyDashboardAnnotationLayer(
    base,
    parseDashboardAnnotation(yaml('go', 'namespace_metric')),
    'namespace'
  );
  expect(ns.origins.get('go')).toBe('namespace');
  const disabled = applyDashboardAnnotationLayer(
    ns,
    parseDashboardAnnotation('[{"name":"go"}]'),
    'workload'
  );
  expect(disabled.templates.some(template => template.name === 'go')).toBe(false);
  const reenabled = applyDashboardAnnotationLayer(
    disabled,
    parseDashboardAnnotation(yaml('go', 'workload_metric')),
    'workload'
  );
  expect(reenabled.disabled.includes('go')).toBe(false);
  expect(reenabled.origins.get('go')).toBe('workload');
  expect(
    reenabled.templates.find(template => template.name === 'go')?.items[0].chart?.metricName
  ).toBe('workload_metric');
  const duplicate = applyDashboardAnnotationLayer(
    base,
    [
      ...parseDashboardAnnotation(yaml('go', 'first')),
      ...parseDashboardAnnotation(yaml('go', 'last')),
    ],
    'namespace'
  );
  expect(
    duplicate.templates.find(template => template.name === 'go')?.items[0].chart?.metricName
  ).toBe('last');
  expect(base).toEqual(snapshot);
});
it('does not expand the effective catalog budget or accept path injection', () => {
  const base = effectiveDashboardCatalog({
    namespaceLabel: 'namespace',
    clusterLabel: 'cluster',
    includeBuiltins: true,
    dashboards: Array.from({ length: 20 }, (_, i) => parseDashboardAnnotation(yaml(`d${i}`))[0]),
  });
  expect(() =>
    applyDashboardAnnotationLayer(base, parseDashboardAnnotation(yaml('extra')), 'namespace')
  ).toThrow('41');
  expect(dashboardAnnotationPath({ namespace: 'bookinfo' })).toBe('/api/v1/namespaces/bookinfo');
  expect(
    dashboardAnnotationPath({ namespace: 'bookinfo', workload: { kind: 'Job', name: 'run' } })
  ).toBe('/apis/batch/v1/namespaces/bookinfo/jobs/run');
  expect(() => dashboardAnnotationPath({ namespace: '../other' })).toThrow('namespace');
});
