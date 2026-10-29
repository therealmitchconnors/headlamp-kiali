import {
  isDashboardDisabled,
  resolveCustomDashboard,
  validateCustomDashboardSettings,
  validateCustomDashboardTemplate,
  validateDashboardCatalog,
} from './customDashboards';
import { effectiveDashboardCatalog } from './dashboardCatalog';
import { dashboardDiscoveryRequest, decodeDashboardDiscovery } from './dashboardDiscovery';

const settings = (dashboards: unknown[]) =>
  validateCustomDashboardSettings({
    namespaceLabel: 'namespace',
    clusterLabel: 'cluster',
    includeBuiltins: true,
    dashboards,
  });
it.each([
  { name: 'go' },
  { name: 'go', items: [] },
  { name: 'go', items: null },
  { name: 'go', discoverOn: null, items: [] },
  { name: 'go', discoverOn: ' \t\u0085\n', items: [] },
])('normalizes a bounded source disable declaration %#', value => {
  const parsed = validateCustomDashboardTemplate(value);
  expect(parsed).toEqual({ name: 'go', title: '', items: [] });
  expect(isDashboardDisabled(parsed)).toBe(true);
});
it('removes a bundled name only from the effective catalog and restores it when the declaration is removed', () => {
  const saved = settings([{ name: 'go' }]);
  const disabled = effectiveDashboardCatalog(saved);
  expect(saved.dashboards).toEqual([{ name: 'go', title: '', items: [] }]);
  expect(disabled.templates).toHaveLength(20);
  expect(disabled.disabled).toEqual(['go']);
  expect(disabled.origins.has('go')).toBe(false);
  expect(disabled.templates.some(template => template.name === 'go')).toBe(false);
  expect(
    effectiveDashboardCatalog(settings([])).templates.some(template => template.name === 'go')
  ).toBe(true);
  expect(validateDashboardCatalog(saved.dashboards)).toEqual([]);
});
it('preserves active charts even without discovery and does not disable a discovery-only definition', () => {
  const active = validateCustomDashboardTemplate({
    name: 'active',
    title: 'Active',
    items: [{ chart: { name: 'C', metricName: 'm', dataType: 'raw' } }],
  });
  const discoveryOnly = validateCustomDashboardTemplate({
    name: 'metadata',
    discoverOn: 'go_info',
  });
  expect(isDashboardDisabled(active)).toBe(false);
  expect(isDashboardDisabled(discoveryOnly)).toBe(false);
  expect(validateDashboardCatalog([discoveryOnly])).toHaveLength(1);
  expect(() => resolveCustomDashboard([discoveryOnly], 'metadata')).toThrow('no charts to load');
});
it('keeps dependent includes broken explicitly rather than resurrecting the bundled definition', () => {
  const catalog = effectiveDashboardCatalog(
    settings([{ name: 'go' }, { name: 'parent', title: 'Parent', items: [{ include: 'go' }] }])
  );
  expect(() => resolveCustomDashboard(catalog.templates, 'parent')).toThrow(
    'Included dashboard is missing: go'
  );
  expect(() => resolveCustomDashboard(catalog.templates, 'go')).toThrow(
    'Included dashboard is missing: go'
  );
});
it('excludes disabled definitions from discovery while keeping discovery-only metadata active', () => {
  const templates = settings([
    { name: 'go' },
    { name: 'metadata', discoverOn: 'other_info' },
  ]).dashboards;
  const query = {
    namespace: 'bookinfo',
    namespaceLabel: 'namespace',
    clusterLabel: 'cluster',
    metricCluster: 'east',
    singleClusterConfirmed: false,
    minutes: 15 as const,
    end: 10000,
    templates,
  };
  expect(dashboardDiscoveryRequest(query).templates.map(template => template.name)).toEqual([
    'metadata',
  ]);
  const result = decodeDashboardDiscovery(
    {
      status: 'success',
      data: {
        resultType: 'vector',
        result: [
          { metric: { __name__: 'go_info' }, value: [10000, '1'] },
          { metric: { __name__: 'other_info' }, value: [10000, '1'] },
        ],
      },
    },
    query
  );
  expect(result.observed).toEqual(['other_info']);
  expect(result.runtimes[0].dashboards[0]).toMatchObject({ name: 'metadata', title: '' });
});
it.each([
  { name: 'go', items: false },
  { name: 'go', items: {} },
  { name: 'go', items: [], extra: 'unsupported' },
  { name: 'go', items: [], discoverOn: '\ufeff' },
  { name: 'go', items: [], discoverOn: ' '.repeat(257) },
  { name: 'go', items: [], runtime: 1 },
  { name: 'go', items: [{ chart: { name: 'C', metricName: 'm', dataType: 'raw' } }] },
])(
  'rejects malformed or unsupported declarations instead of treating them as disabled %#',
  value => {
    expect(() => validateCustomDashboardTemplate(value)).toThrow();
  }
);
it('keeps disabling declarations within saved collection and duplicate-name budgets', () => {
  expect(
    settings(Array.from({ length: 20 }, (_, i) => ({ name: `d${i}` }))).dashboards
  ).toHaveLength(20);
  expect(() => settings(Array.from({ length: 21 }, (_, i) => ({ name: `d${i}` })))).toThrow(
    'At most 20'
  );
  expect(() => settings([{ name: 'go' }, { name: 'go' }])).toThrow('distinct');
});
