import {
  customDashboardJobs,
  CustomDashboardQuery,
  resolveCustomDashboard,
  validateCustomDashboard,
} from './customDashboards';

const query = (): CustomDashboardQuery => ({
  namespace: 'bookinfo',
  namespaceLabel: 'namespace',
  clusterLabel: 'cluster',
  metricCluster: 'east',
  singleClusterConfirmed: false,
  minutes: 15,
  end: 10000,
  dashboard: {
    name: 'runtime',
    title: 'Runtime',
    items: [{ chart: { name: 'A', metricName: 'm', dataType: 'raw' } }],
  },
});
it.each([true, false])(
  'preserves explicit startCollapsed %s through capture and includes without skipping requests',
  startCollapsed => {
    const input = query();
    const expressions = customDashboardJobs(input).map(job => job.expression);
    input.dashboard.items[0].chart.startCollapsed = startCollapsed;
    expect(customDashboardJobs(input).map(job => job.expression)).toEqual(expressions);
    expect(
      resolveCustomDashboard(
        [input.dashboard, { name: 'parent', title: 'Parent', items: [{ include: 'runtime' }] }],
        'parent'
      ).dashboard.items[0].chart.startCollapsed
    ).toBe(startCollapsed);
  }
);
it.each([undefined, null])(
  'keeps unspecified visibility expanded without persisting an invented preference: %j',
  startCollapsed => {
    const input = query();
    expect(
      validateCustomDashboard({
        ...input.dashboard,
        items: [{ chart: { ...input.dashboard.items[0].chart, startCollapsed } }],
      }).items[0].chart.startCollapsed
    ).toBeUndefined();
  }
);
it.each(['true', 'false', 0, 1, [], {}].map(startCollapsed => ({ startCollapsed })))(
  'rejects invalid visibility $startCollapsed',
  ({ startCollapsed }) => {
    const input = query();
    expect(() =>
      validateCustomDashboard({
        ...input.dashboard,
        items: [{ chart: { ...input.dashboard.items[0].chart, startCollapsed } }],
      })
    ).toThrow('startCollapsed must be a boolean');
  }
);
it('does not increase the eight-request budget when every chart starts collapsed', () => {
  const input = query();
  input.dashboard.items[0].chart.startCollapsed = true;
  input.dashboard.items[0].chart.metrics = Array.from({ length: 8 }, (_, i) => ({
    metricName: `m${i}`,
    displayName: `M${i}`,
  }));
  expect(customDashboardJobs(input)).toHaveLength(8);
  input.dashboard.items.push({
    chart: { name: 'B', metricName: 'extra', dataType: 'raw', startCollapsed: true },
  });
  expect(() => customDashboardJobs(input)).toThrow('at most 8 metric queries');
});
