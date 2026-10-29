import {
  customDashboardJobs,
  CustomDashboardTemplate,
  resolveCustomDashboard,
  validateCustomDashboardSettings,
  validateCustomDashboardTemplate,
} from './customDashboards';

const chart = (name: string, metricName = name.toLowerCase()) => ({
  chart: { name, metricName, dataType: 'raw' as const, unit: 'bytes' },
});
const template = (
  name: string,
  items: CustomDashboardTemplate['items']
): CustomDashboardTemplate => ({
  name,
  title: `${name} title`,
  items,
});
const jobs = (templates: CustomDashboardTemplate[]) =>
  customDashboardJobs({
    namespace: 'bookinfo',
    metricCluster: 'east',
    singleClusterConfirmed: false,
    namespaceLabel: 'namespace',
    clusterLabel: 'cluster',
    minutes: 15,
    end: 10000,
    dashboard: resolveCustomDashboard(templates, templates[0].name).dashboard,
  });

it('resolves ordered nested whole-template and exact chart includes with immutable provenance', () => {
  const templates = [
    template('root', [chart('First'), { include: 'nested' }, chart('Last')]),
    template('nested', [{ include: 'leaf$Second' }, chart('Third')]),
    template('leaf', [chart('Ignored'), chart('Second')]),
  ];
  const original = structuredClone(templates);
  const resolved = resolveCustomDashboard(templates, 'root');
  expect(resolved.dashboard.name).toBe('root');
  expect(resolved.dashboard.title).toBe('root title');
  expect(resolved.dashboard.items.map(item => item.chart.name)).toEqual([
    'First',
    'Second',
    'Third',
    'Last',
  ]);
  expect(resolved.references).toEqual(templates.map(({ name, title }) => ({ name, title })));
  resolved.dashboard.items[1].chart.metricName = 'changed';
  resolved.references[1].title = 'changed';
  expect(templates).toEqual(original);
  expect(jobs(templates).map(job => job.expression)).toEqual(
    ['first', 'second', 'third', 'last'].map(
      metric => `sum(${metric}{namespace="bookinfo",cluster="east"})`
    )
  );
});
it('trims Go edge whitespace and gives a nonempty include precedence over a valid shadow chart', () => {
  const value = validateCustomDashboardTemplate(
    template('root', [{ include: '\u0085 \t leaf$Chosen \n\u0085', ...chart('Shadow') }])
  );
  expect(value.items[0].include).toBe('\u0085 \t leaf$Chosen \n\u0085');
  expect(value.items[0].chart?.name).toBe('Shadow');
  expect(
    resolveCustomDashboard([value, template('leaf', [chart('Chosen')])], 'root').dashboard.items[0]
      .chart.name
  ).toBe('Chosen');
  expect(() =>
    validateCustomDashboardTemplate(template('root', [{ include: '\ufeffleaf' }]))
  ).toThrow();
});
it.each([undefined, null, '', ' \n\t\u0085 '])(
  'uses a chart when include is absent or empty %#',
  include => {
    const value = validateCustomDashboardTemplate({
      ...template('root', []),
      items: [{ include, ...chart('Memory') }],
    });
    expect(value.items).toEqual([
      { chart: { ...chart('Memory').chart, aggregator: 'sum', unitScale: 1 } },
    ]);
  }
);
it.each(
  [
    [template('root', [{ include: 'root' }])],
    [template('root', [{ include: 'other' }]), template('other', [{ include: 'root' }])],
    [
      template('root', [{ include: 'leaf$A' }, { include: 'leaf$B' }]),
      template('leaf', [chart('A'), chart('B')]),
    ],
    [
      template('root', [{ include: 'left' }, { include: 'right' }]),
      template('left', [{ include: 'leaf' }]),
      template('right', [{ include: 'leaf' }]),
      template('leaf', [chart('A')]),
    ],
  ].map(templates => ({ templates }))
)('retains the pinned shared visited set %#', ({ templates }) => {
  expect(() => resolveCustomDashboard(templates, 'root')).toThrow('Repeated or circular');
});
it('resolves the whole referenced template before selecting a chart', () => {
  expect(() =>
    resolveCustomDashboard(
      [
        template('root', [{ include: 'leaf$Wanted' }]),
        template('leaf', [chart('Wanted'), { include: 'missing' }]),
      ],
      'root'
    )
  ).toThrow('Included dashboard is missing: missing');
});
it('selects the first exact matching chart from expanded includes, without case folding', () => {
  const templates = [
    template('root', [{ include: 'middle$Same' }]),
    template('middle', [chart('Same', 'first'), { include: 'leaf' }]),
    template('leaf', [chart('Same', 'second')]),
  ];
  expect(resolveCustomDashboard(templates, 'root').dashboard.items[0].chart.metricName).toBe(
    'first'
  );
  templates[0].items = [{ include: 'middle$same' }];
  expect(() => resolveCustomDashboard(templates, 'root')).toThrow('Included chart was not found');
  templates[0].items = [{ include: 'middle' }];
  expect(() => resolveCustomDashboard(templates, 'root')).toThrow('chart names must be distinct');
});
it('rejects missing chart/template selections explicitly rather than returning an empty dashboard', () => {
  const templates = [
    template('root', [{ include: 'leaf$Absent' }]),
    template('leaf', [chart('Present')]),
  ];
  expect(() => resolveCustomDashboard(templates, 'root')).toThrow(
    'Included chart was not found: leaf$Absent'
  );
  expect(() => resolveCustomDashboard(templates, 'missing')).toThrow(
    'Included dashboard is missing: missing'
  );
});
it.each([
  { include: 'leaf$' },
  { include: 'leaf$Chart$ignored' },
  { include: 'https://example.com' },
  { include: 'leaf $Chart' },
  { include: 1 },
  { include: 'x'.repeat(1025) },
  {},
  { include: '', chart: null },
  { include: 'leaf', endpoint: 'elsewhere' },
  { include: 'leaf', chart: { ...chart('Shadow').chart, metricName: 'sum(up)' } },
])('rejects malformed, unsupported and unsafe shadow declarations %#', item => {
  expect(() =>
    validateCustomDashboardTemplate({ ...template('root', []), items: [item] })
  ).toThrow();
});
it('preserves definitions and unresolved references in settings without flattening or remote lookup', () => {
  const definitions = [template('root', [{ include: 'later' }])];
  const result = validateCustomDashboardSettings({
    namespaceLabel: 'namespace',
    clusterLabel: 'cluster',
    dashboards: definitions,
  });
  expect(result.dashboards).toEqual(definitions);
  result.dashboards[0].items[0].include = 'edited';
  expect(definitions[0].items[0].include).toBe('later');
});
it('bounds all selected expansions before expression construction, including metrics and histogram summaries', () => {
  const definitions = [
    template('root', [{ include: 'leaf' }]),
    template(
      'leaf',
      Array.from({ length: 8 }, (_, i) => chart(`C${i}`))
    ),
  ];
  expect(jobs(definitions)).toHaveLength(8);
  definitions[0].items.push(chart('Ninth'));
  expect(() => jobs(definitions)).toThrow('1 to 8');
  definitions[0].items.pop();
  definitions[1].items[0].chart!.metrics = [
    { metricName: 'a', displayName: 'A' },
    { metricName: 'b', displayName: 'B' },
  ];
  expect(() => jobs(definitions)).toThrow('8 metric queries');
  definitions[1].items[0].chart!.metrics = [];
  definitions[1].items[0].chart!.dataType = 'histogram';
  expect(() => jobs(definitions)).toThrow('8 metric queries');
});
it('allows a bounded chart subset from a larger intermediate expansion', () => {
  const definitions = [
    template('root', [{ include: 'middle$Wanted' }]),
    template('middle', [chart('Wanted'), { include: 'leaf' }]),
    template(
      'leaf',
      Array.from({ length: 8 }, (_, i) => chart(`C${i}`))
    ),
  ];
  expect(jobs(definitions)).toHaveLength(1);
  expect(() => resolveCustomDashboard(definitions, 'middle')).toThrow('1 to 8');
});
it('supports exactly twenty visited templates and rejects excess, duplicate and oversized definitions', () => {
  const chain = Array.from({ length: 20 }, (_, i) =>
    template(`t${i}`, i === 19 ? [chart('Leaf')] : [{ include: `t${i + 1}` }])
  );
  expect(resolveCustomDashboard(chain, 't0').references).toHaveLength(20);
  expect(() =>
    resolveCustomDashboard([...chain, template('extra', [chart('Extra')])], 't0')
  ).toThrow('At most 20');
  expect(() => resolveCustomDashboard([chain[0], chain[0]], 't0')).toThrow(
    'names must be distinct'
  );
  const oversized = Array.from({ length: 20 }, (_, i) =>
    template(
      `t${i}`,
      Array.from({ length: 8 }, (_, j) => chart(`C${j}${'c'.repeat(250)}`, 'm'.repeat(256)))
    )
  );
  expect(() => resolveCustomDashboard(oversized, 't0')).toThrow('64 KiB');
});
