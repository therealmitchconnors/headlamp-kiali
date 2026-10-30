import { dashboardPlotHeight, validateDashboardRows } from './chartDisplay';
import {
  customDashboardJobs,
  CustomDashboardQuery,
  resolveCustomDashboard,
  validateCustomDashboard,
  validateCustomDashboardSettings,
} from './customDashboards';
import { applyDashboardAnnotationLayer, parseDashboardAnnotation } from './dashboardAnnotations';
import { effectiveDashboardCatalog } from './dashboardCatalog';

const template = {
  name: 'runtime',
  title: 'Runtime',
  items: [{ chart: { name: 'Memory', metricName: 'memory', dataType: 'raw' as const } }],
};
it.each([
  [undefined, undefined],
  [null, undefined],
  [0, 2],
  [-3, 2],
  [Number.MIN_SAFE_INTEGER, 2],
  [1, 1],
  [3, 3],
  [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
])('normalizes pinned dashboard row metadata %#', (input, expected) => {
  expect(validateDashboardRows(input)).toBe(expected);
  expect(validateCustomDashboard({ ...template, rows: input }).rows).toBe(expected);
});
it.each(['2', '', 1.5, true, {}, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid rows rather than silently selecting a layout %#',
  rows => {
    expect(() => validateCustomDashboard({ ...template, rows })).toThrow('safe integer');
  }
);
it.each<[number, number | undefined, boolean, number]>([
  [0, undefined, false, 150],
  [800, undefined, false, 392],
  [800, 0, false, 392],
  [800, -1, false, 392],
  [800, 1, false, 800],
  [800, 3, false, 256],
  [800, 4, false, 188],
  [300, 3, false, 150],
  [800, Number.MAX_SAFE_INTEGER, false, 150],
  [801.5, 2, false, 392],
  [801.5, 3, true, 801.5],
  [100, 1, true, 150],
])(
  'uses pinned row gap, integer floor and minimum height %#',
  (height, rows, expanded, expected) => {
    expect(dashboardPlotHeight(height, rows, expanded)).toBe(expected);
  }
);
it.each([NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid viewport geometry %#',
  height => {
    expect(() => dashboardPlotHeight(height, 2)).toThrow('viewport height');
  }
);
it('retains the selected template row preference rather than inheriting included layouts', () => {
  const templates = [
    { ...template, rows: 4 },
    { name: 'parent', title: 'Parent', rows: 3, items: [{ include: 'runtime' }] },
    { name: 'natural', title: 'Natural', items: [{ include: 'runtime' }] },
  ];
  expect(resolveCustomDashboard(templates, 'parent').dashboard.rows).toBe(3);
  expect(resolveCustomDashboard(templates, 'natural').dashboard.rows).toBeUndefined();
  const settings = validateCustomDashboardSettings({
    namespaceLabel: 'namespace',
    clusterLabel: null,
    dashboards: templates,
  });
  const saved = effectiveDashboardCatalog(settings);
  const annotated = applyDashboardAnnotationLayer(
    saved,
    parseDashboardAnnotation(JSON.stringify([{ ...template, rows: 1 }])),
    'namespace'
  );
  expect(resolveCustomDashboard(annotated.templates, 'runtime').dashboard.rows).toBe(1);
  expect(resolveCustomDashboard(saved.templates, 'runtime').dashboard.rows).toBe(4);
});
it('keeps queries and source chart selection independent of the preferred plot-row count', () => {
  const query: CustomDashboardQuery = {
    namespace: 'bookinfo',
    namespaceLabel: 'namespace',
    clusterLabel: null,
    metricCluster: '',
    singleClusterConfirmed: true,
    end: 10000,
    minutes: 15,
    dashboard: validateCustomDashboard(template),
  };
  const jobs = customDashboardJobs(query);
  for (const rows of [1, 2, 20]) {
    const changed = { ...query, dashboard: { ...query.dashboard, rows } };
    expect(customDashboardJobs(changed)).toEqual(jobs);
  }
});
it('does not activate the unused frontend rowSpans field as a chart declaration', () => {
  expect(() =>
    validateCustomDashboard({
      ...template,
      items: [{ chart: { ...template.items[0].chart, rowSpans: 2 } }],
    })
  ).toThrow('unsupported fields: rowSpans');
});
