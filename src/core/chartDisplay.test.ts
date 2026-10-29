import { metricAxis, validateChartDisplay } from './chartDisplay';
import { customDashboardJobs, validateCustomDashboard } from './customDashboards';

it('preserves explicit zero bounds and supported spans while omitting null/default display options', () => {
  expect(validateChartDisplay({ min: 0, max: 10, spans: 3 })).toEqual({
    min: 0,
    max: 10,
    spans: 3,
  });
  expect(validateChartDisplay({ min: null, max: null, spans: 0 })).toEqual({});
  expect(validateChartDisplay({})).toEqual({});
  for (const spans of [1, 6, 12]) expect(validateChartDisplay({ spans }).spans).toBe(spans);
});
it.each([
  { min: '0' },
  { max: NaN },
  { min: Infinity },
  { min: 0.1 },
  { max: Number.MAX_SAFE_INTEGER + 1 },
  { min: 2, max: 1 },
  { min: 0, max: 0 },
  { spans: -1 },
  { spans: 13 },
  { spans: 1.5 },
  { spans: '6' },
])('rejects invalid or reversed display options %#', options => {
  expect(() => validateChartDisplay(options)).toThrow();
});
it('keeps auto rendering unchanged unless bounds are explicitly requested', () => {
  expect(metricAxis([-2, 0, 3, null], {})).toEqual({ outside: 0 });
});
it('counts outside samples without changing numeric values or explicit endpoints', () => {
  const values = Object.freeze([-2, 0, 5, 10, 12, null]);
  expect(metricAxis(values, { min: 0, max: 10 })).toEqual({ domain: [0, 10], outside: 2 });
  expect(values).toEqual([-2, 0, 5, 10, 12, null]);
  expect(metricAxis([5, 10], { min: 0 })).toEqual({ domain: [0, 10], outside: 0 });
  expect(metricAxis([-5, 0], { max: 0 })).toEqual({ domain: [-5, 0], outside: 0 });
});
it('expands only an automatic edge for all-outside, constant or empty data', () => {
  expect(metricAxis([-5, -1], { min: 0 })).toEqual({ domain: [0, 1], outside: 2 });
  expect(metricAxis([1, 5], { max: 0 })).toEqual({ domain: [-1, 0], outside: 2 });
  expect(metricAxis([100], { min: 100 })).toEqual({ domain: [100, 101], outside: 0 });
  expect(metricAxis([], { min: 0 })).toEqual({ domain: [0, 1], outside: 0 });
  expect(metricAxis([null], { max: 0 })).toEqual({ domain: [-1, 0], outside: 0 });
});
it('bounds geometry and samples rather than emitting nonfinite SVG coordinates', () => {
  expect(metricAxis(Array(1928).fill(1), { min: 0, max: 2 }).outside).toBe(0);
  expect(() => metricAxis(Array(1929).fill(1), { min: 0 })).toThrow('1928');
  expect(() => metricAxis([Infinity], { min: 0 })).toThrow('finite');
  expect(() => metricAxis([Number.MAX_VALUE], { min: 0, max: 1 })).toThrow('safely');
});
it('captures display options without changing metric query construction or scale', () => {
  const dashboard = validateCustomDashboard({
    name: 'd',
    title: 'D',
    items: [
      {
        chart: {
          name: 'C',
          metricName: 'm',
          dataType: 'raw',
          unitScale: 0.001,
          min: 0,
          max: 10,
          spans: 6,
        },
      },
    ],
  });
  const jobs = customDashboardJobs({
    namespace: 'bookinfo',
    namespaceLabel: 'namespace',
    clusterLabel: 'cluster',
    metricCluster: 'east',
    singleClusterConfirmed: false,
    minutes: 15,
    end: 10000,
    dashboard,
  });
  expect(jobs[0].expression).toBe('sum(m{namespace="bookinfo",cluster="east"})');
  expect(jobs[0].chart).toMatchObject({ min: 0, max: 10, spans: 6, unitScale: 0.001 });
});
