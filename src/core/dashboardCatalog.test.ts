import { createHash } from 'node:crypto';
import rawCatalog from './builtinDashboards.json?raw';
import {
  customDashboardJobs,
  CustomDashboardSettings,
  resolveCustomDashboard,
  validateCustomDashboardSettings,
  validateDashboardCatalog,
} from './customDashboards';
import {
  BUILTIN_DASHBOARD_SOURCE,
  builtinDashboardTemplates,
  effectiveDashboardCatalog,
} from './dashboardCatalog';
import { dashboardDiscoveryRequest, decodeDashboardDiscovery } from './dashboardDiscovery';

const settings = (includeBuiltins = false): CustomDashboardSettings => ({
  namespaceLabel: 'namespace',
  clusterLabel: 'cluster',
  includeBuiltins,
  dashboards: [],
});
const source: { dashboards: { name: string; items: { chart?: unknown }[] }[] } =
  JSON.parse(rawCatalog);
it('preserves the complete pinned catalog and isolates every returned copy', () => {
  expect(createHash('sha256').update(rawCatalog).digest('hex')).toBe(
    'ef584498688cbf0cf3a7b5ffd314d45e373ad1176484cb8523691ba53a5ef35a'
  );
  expect(source.dashboards).toHaveLength(21);
  expect(
    source.dashboards.flatMap(template => template.items).filter(item => item.chart)
  ).toHaveLength(91);
  const first = builtinDashboardTemplates();
  expect(first.map(template => template.name)).toEqual(
    source.dashboards.map(template => template.name)
  );
  first[0].title = 'mutated';
  expect(builtinDashboardTemplates()[0].title).toBe('Istiod Metrics');
  expect(BUILTIN_DASHBOARD_SOURCE.commit).toBe('0e8be887b8217bbcac5e3ae0bfcd258073949cca');
});
it.each(source.dashboards.map(template => ({ name: template.name })))(
  'resolves every $name chart without unsupported fields or dropped requests',
  ({ name }) => {
    const resolved = resolveCustomDashboard(builtinDashboardTemplates(), name).dashboard;
    expect(resolved.items.length).toBeGreaterThan(0);
    for (const { chart } of resolved.items) {
      const jobs = customDashboardJobs({
        namespace: 'bookinfo',
        namespaceLabel: 'namespace',
        clusterLabel: 'cluster',
        metricCluster: 'east',
        singleClusterConfirmed: false,
        minutes: 15,
        end: 10000,
        dashboard: resolved,
        chartNames: [chart.name],
      });
      expect(jobs).toHaveLength(chart.dataType === 'histogram' ? 2 : 1);
      expect(jobs.every(job => job.chart.name === chart.name)).toBe(true);
    }
  }
);
it('keeps bundled templates opt-in and saved definitions authoritative by name', () => {
  expect(effectiveDashboardCatalog(settings()).templates).toEqual([]);
  const input = settings(true);
  input.dashboards = [
    {
      name: 'go',
      title: 'User Go',
      items: [{ chart: { name: 'Custom', metricName: 'custom_metric', dataType: 'raw' } }],
    },
  ];
  const catalog = effectiveDashboardCatalog(input);
  expect(catalog.templates).toHaveLength(21);
  expect(catalog.templates[0].title).toBe('User Go');
  expect(catalog.origins.get('go')).toBe('custom');
  expect(catalog.origins.get('envoy')).toBe('builtin');
  expect(resolveCustomDashboard(catalog.templates, 'go').dashboard.items[0].chart.metricName).toBe(
    'custom_metric'
  );
  expect(input.dashboards).toHaveLength(1);
  input.includeBuiltins = false;
  expect(effectiveDashboardCatalog(input).templates).toHaveLength(1);
});
it('keeps source/user and effective metadata budgets separate', () => {
  const input = settings(true);
  input.dashboards = Array.from({ length: 20 }, (_, i) => ({
    name: `custom${i}`,
    title: `Custom ${i}`,
    items: [{ chart: { name: 'C', metricName: 'm', dataType: 'raw' } }],
  }));
  expect(effectiveDashboardCatalog(input).templates).toHaveLength(41);
  expect(() =>
    validateCustomDashboardSettings({
      ...input,
      dashboards: [...input.dashboards, { ...input.dashboards[0], name: 'extra' }],
    })
  ).toThrow('At most 20');
  expect(() =>
    validateDashboardCatalog(
      Array.from({ length: 42 }, (_, i) => ({ ...input.dashboards[0], name: `d${i}` }))
    )
  ).toThrow('41');
  for (const includeBuiltins of [null, 1, 'true', [], {}])
    expect(() => validateCustomDashboardSettings({ ...settings(), includeBuiltins })).toThrow(
      'boolean'
    );
});
it('supports explicit discovery against the entire effective catalog without chart fetching', () => {
  const catalog = effectiveDashboardCatalog(settings(true));
  const query = {
    namespace: 'bookinfo',
    namespaceLabel: 'namespace',
    clusterLabel: 'cluster',
    metricCluster: 'east',
    singleClusterConfirmed: false,
    minutes: 15 as const,
    end: 10000,
    templates: catalog.templates,
  };
  expect(dashboardDiscoveryRequest(query).templates).toHaveLength(21);
  const result = decodeDashboardDiscovery(
    {
      status: 'success',
      data: {
        resultType: 'vector',
        result: [{ metric: { __name__: 'go_info' }, value: [10000, '1'] }],
      },
    },
    query
  );
  expect(
    result.runtimes.some(runtime => runtime.dashboards.some(template => template.name === 'go'))
  ).toBe(true);
});
