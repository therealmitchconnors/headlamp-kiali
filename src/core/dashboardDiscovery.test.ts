import { validateCustomDashboardSettings } from './customDashboards';
import {
  DashboardDiscoveryQuery,
  dashboardDiscoveryRequest,
  decodeDashboardDiscovery,
  matchDashboardRuntimes,
} from './dashboardDiscovery';

const template = (name: string, discoverOn = `${name}_info`, runtime = 'Runtime') => ({
  name,
  title: name,
  discoverOn,
  runtime,
  items: [
    {
      chart: {
        name: 'Memory',
        metricName: 'memory_bytes',
        dataType: 'raw' as const,
        unit: 'bytes',
      },
    },
  ],
});
const query = (): DashboardDiscoveryQuery => ({
  namespace: 'bookinfo',
  metricCluster: 'east',
  singleClusterConfirmed: false,
  namespaceLabel: 'namespace',
  clusterLabel: 'cluster',
  labelsFilters: { job: 'runtime' },
  minutes: 15,
  end: 10000,
  templates: [template('runtime')],
});
const vector = (names: string[], value = '1', timestamp = 10000) => ({
  status: 'success',
  data: {
    resultType: 'vector',
    result: names.map(name => ({ metric: { __name__: name }, value: [timestamp, value] })),
  },
});
it('captures scoped count-by-name discovery at one instant without a histogram or range query', () => {
  const plan = dashboardDiscoveryRequest(query());
  expect(plan.expression).toBe(
    'count({namespace="bookinfo",cluster="east",job="runtime"}) by (__name__)'
  );
  expect(new URLSearchParams(plan.parameters).get('time')).toBe('10000');
  expect(new URLSearchParams(plan.parameters).has('start')).toBe(false);
  expect(plan.templates[0]).toMatchObject({ runtime: 'Runtime', discoverOn: 'runtime_info' });
  expect(decodeDashboardDiscovery(vector(['runtime_info', 'unrelated']), query()).observed).toEqual(
    ['runtime_info']
  );
});
it('does not replace explicit scoping or the single-cluster-source acknowledgment', () => {
  expect(() => dashboardDiscoveryRequest({ ...query(), namespace: '' })).toThrow('namespace');
  expect(() => dashboardDiscoveryRequest({ ...query(), clusterLabel: null })).toThrow('Confirm');
  expect(
    dashboardDiscoveryRequest({ ...query(), clusterLabel: null, singleClusterConfirmed: true })
      .expression
  ).not.toContain('cluster=');
  expect(() =>
    dashboardDiscoveryRequest({ ...query(), labelsFilters: { namespace: 'other' } })
  ).toThrow('cannot replace');
  expect(() =>
    dashboardDiscoveryRequest({
      ...query(),
      templates: [{ ...template('runtime'), discoverOn: undefined }],
    })
  ).toThrow('discoverOn');
});
it('bounds encoded discovery filters and saved metadata', () => {
  expect(() =>
    dashboardDiscoveryRequest({
      ...query(),
      labelsFilters: Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`k${i}`, '\u00e9'.repeat(1024)])
      ),
    })
  ).toThrow('16 KiB');
  for (const overrides of [
    { discoverOn: ' runtime_info ' },
    { discoverOn: 'up{job="x"}' },
    { runtime: '\ud800' },
    { runtime: 'x'.repeat(129) },
  ])
    expect(() =>
      dashboardDiscoveryRequest({
        ...query(),
        templates: [{ ...template('runtime'), ...overrides }],
      })
    ).toThrow();
});
it.each(['0', 'NaN', '1'])(
  'matches returned metric names rather than interpreting count %s as health',
  value => {
    expect(
      decodeDashboardDiscovery(vector(['runtime_info'], value), query()).runtimes
    ).toHaveLength(1);
  }
);
it('preserves warnings and distinguishes empty results from failure', () => {
  expect(decodeDashboardDiscovery({ ...vector([]), warnings: ['partial data'] }, query())).toEqual({
    observed: [],
    runtimes: [],
    warnings: ['partial data'],
  });
  expect(() =>
    decodeDashboardDiscovery({ status: 'error', error: 'provider denied' }, query())
  ).toThrow('provider denied');
});
it('rejects duplicate names, unintended dimensions and mismatched captured times', () => {
  expect(() => decodeDashboardDiscovery(vector(['runtime_info', 'runtime_info']), query())).toThrow(
    'duplicate'
  );
  expect(() => decodeDashboardDiscovery(vector(['runtime_info'], '1', 10002), query())).toThrow(
    'captured instant'
  );
  const unexpected = vector(['runtime_info']);
  Object.assign(unexpected.data.result[0].metric, { pod: 'other' });
  expect(() => decodeDashboardDiscovery(unexpected, query())).toThrow('only the __name__');
  expect(() =>
    decodeDashboardDiscovery(vector(Array.from({ length: 2001 }, (_, i) => `m${i}`)), query())
  ).toThrow('2,000');
  expect(
    decodeDashboardDiscovery(vector(Array.from({ length: 2000 }, (_, i) => `m${i}`)), query())
      .runtimes
  ).toEqual([]);
});
it.each([
  { include: 'child', names: ['parent_info', 'child_info'], expected: ['parent'] },
  { include: ' child ', names: ['parent_info', 'child_info'], expected: ['child', 'parent'] },
  { include: 'child$Memory', names: ['parent_info', 'child_info'], expected: ['child', 'parent'] },
  { include: 'child', names: ['child_info'], expected: ['child'] },
])(
  'uses literal direct suppression only from matching templates %#',
  ({ include, names, expected }) => {
    const templates = validateCustomDashboardSettings({
      namespaceLabel: 'namespace',
      clusterLabel: 'cluster',
      dashboards: [{ ...template('parent'), items: [{ include }] }, template('child')],
    }).dashboards;
    expect(templates[0].items[0].include).toBe(include);
    expect(matchDashboardRuntimes(templates, names)[0].dashboards.map(item => item.name)).toEqual(
      expected
    );
  }
);
it('does not recursively suppress unmatched descendants or resolve composition during discovery', () => {
  const templates = [
    { ...template('parent'), items: [{ include: 'child' }] },
    { ...template('child'), items: [{ include: 'grandchild' }] },
    template('grandchild'),
  ];
  expect(
    matchDashboardRuntimes(templates, ['parent_info', 'grandchild_info'])[0].dashboards.map(
      item => item.name
    )
  ).toEqual(['grandchild', 'parent']);
  expect(
    matchDashboardRuntimes(
      [{ ...template('root'), items: [{ include: 'missing' }] }],
      ['root_info']
    )[0].dashboards[0].name
  ).toBe('root');
});
it('groups declared runtime names, keeps unspecified runtime and sorts UTF-8 rather than browser locale', () => {
  const templates = [
    template('a', 'same', '\u{10000}'),
    template('b', 'same', '\ue000'),
    template('c', 'same', ''),
  ];
  expect(matchDashboardRuntimes(templates, ['same']).map(runtime => runtime.name)).toEqual([
    '',
    '\ue000',
    '\u{10000}',
  ]);
});
