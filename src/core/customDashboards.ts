import { ChartDisplay, validateChartDisplay } from './chartDisplay';
import {
  DashboardAggregation,
  dashboardByLabels,
  validateDashboardAggregations,
} from './dashboardAggregations';
import type { DashboardAnnotationSource } from './dashboardAnnotations';
import { trimGoSpace } from './goStrings';
import { histogramExpressions, HistogramSummary } from './histograms';
import { metricGroupLabels } from './metricGroups';
import { metricRangeParameters, MetricTimeRange, validateMetricTimeRange } from './metricRanges';
import { isDnsLabel, isRecord } from './object';
import { metricSelector } from './telemetry';

export const MAX_EFFECTIVE_DASHBOARD_TEMPLATES = 41;
export const MAX_RESOLVED_DASHBOARD_CHARTS = MAX_EFFECTIVE_DASHBOARD_TEMPLATES * 8;
const CUSTOM_DASHBOARD_BYTES = 65536;
// Separate 64 KiB budgets for the saved-user definitions and pinned bundled catalog.
const EFFECTIVE_DASHBOARD_BYTES = CUSTOM_DASHBOARD_BYTES * 2;
export interface CustomChart extends ChartDisplay {
  name: string;
  metricName?: string;
  metrics?: CustomDashboardMetric[];
  unit?: string;
  dataType: 'raw' | 'rate' | 'histogram';
  aggregator?: 'sum' | 'avg' | 'min' | 'max';
  unitScale?: number;
  groupLabels?: string[];
  aggregations?: DashboardAggregation[];
}
export interface CustomDashboardMetric {
  metricName: string;
  displayName: string;
}
export interface CustomDashboard {
  name: string;
  title: string;
  runtime?: string;
  discoverOn?: string;
  items: { chart: CustomChart }[];
}
export interface CustomDashboardTemplate extends Omit<CustomDashboard, 'items'> {
  items: { chart?: CustomChart; include?: string }[];
}
export interface CustomDashboardSettings {
  namespaceLabel: string;
  clusterLabel: string | null;
  dashboards: CustomDashboardTemplate[];
  includeBuiltins?: boolean;
}
export interface CustomDashboardScopeQuery extends MetricTimeRange {
  namespace: string;
  metricCluster: string;
  singleClusterConfirmed: boolean;
  namespaceLabel: string;
  clusterLabel: string | null;
  labelsFilters?: Record<string, string>;
  annotationSources?: DashboardAnnotationSource[];
}
export interface CustomDashboardQuery extends CustomDashboardScopeQuery {
  dashboard: CustomDashboard;
  chartNames?: string[];
  byLabels?: string[];
  histogramSummaries?: HistogramSummary[];
  templateReferences?: {
    name: string;
    title: string;
    origin?: 'builtin' | 'custom' | 'namespace' | 'workload';
  }[];
}
export interface CustomDashboardJob {
  key: string;
  chart: CustomChart;
  expression: string;
  summary?: HistogramSummary;
  chartIndex: number;
  metric: CustomDashboardMetric;
  groupLabels: string[];
}

function keys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  const unsupported = Object.keys(value).filter(key => !allowed.includes(key));
  if (unsupported.length)
    throw new Error(`${label} contains unsupported fields: ${unsupported.join(', ')}`);
}
function text(value: unknown, maximum: number, label: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error(
      `${label} requires 1 to ${maximum} characters with nonblank text and no controls`
    );
  return value;
}
export function metricName(value: unknown): string {
  const name = text(value, 256, 'Dashboard metric name');
  if (/^[A-Za-z_:][A-Za-z0-9_:]*$/.exec(name)?.[0] !== name)
    throw new Error('Dashboard metrics must be metric names, not PromQL expressions');
  return name;
}
export function dashboardLabel(value: unknown): string {
  const name = text(value, 256, 'Dashboard label name');
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.exec(name)?.[0] !== name || name === '__name__')
    throw new Error('Dashboard scope labels must be Prometheus label names other than __name__');
  return name;
}
function dashboardHeader(value: unknown, maximum: number = 8, allowEmpty = false) {
  if (!isRecord(value)) throw new Error('A custom dashboard must be an object');
  keys(value, ['name', 'title', 'runtime', 'discoverOn', 'items'], 'Custom dashboard');
  const name = text(value.name, 128, 'Dashboard name');
  if (/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.exec(name)?.[0] !== name)
    throw new Error('Dashboard names require letters, digits, dot, underscore or hyphen');
  const rawItems =
    allowEmpty && (value.items === undefined || value.items === null) ? [] : value.items;
  if (!Array.isArray(rawItems) || (!allowEmpty && !rawItems.length) || rawItems.length > maximum)
    throw new Error(
      maximum === 8
        ? allowEmpty
          ? 'Dashboard definitions support at most 8 source items'
          : 'Dashboard definitions require 1 to 8 source items'
        : 'Resolved dashboards require 1 to 328 charts'
    );
  const title =
    allowEmpty &&
    rawItems.length === 0 &&
    (value.title === undefined || value.title === null || value.title === '')
      ? ''
      : text(value.title, 256, 'Dashboard title');
  const runtime =
    value.runtime === undefined || value.runtime === null || value.runtime === ''
      ? undefined
      : text(value.runtime, 128, 'Dashboard runtime');
  if (runtime && /[\ud800-\udfff]/u.test(runtime))
    throw new Error('Dashboard runtime cannot contain unpaired surrogates');
  const discoverOn =
    value.discoverOn === undefined ||
    value.discoverOn === null ||
    (typeof value.discoverOn === 'string' &&
      value.discoverOn.length <= 256 &&
      trimGoSpace(value.discoverOn) === '')
      ? undefined
      : metricName(value.discoverOn);
  const metadata = {
    ...(runtime !== undefined ? { runtime } : {}),
    ...(discoverOn !== undefined ? { discoverOn } : {}),
  };
  return { name, title, metadata, rawItems };
}
export function validateCustomDashboard(value: unknown): CustomDashboard {
  return validateChartDashboard(value, 8);
}
export function validateResolvedCustomDashboard(value: unknown): CustomDashboard {
  const dashboard = validateChartDashboard(value, MAX_RESOLVED_DASHBOARD_CHARTS);
  if (JSON.stringify(dashboard).length > EFFECTIVE_DASHBOARD_BYTES)
    throw new Error('Resolved dashboard metadata exceeds 128 KiB');
  return dashboard;
}
function validateChartDashboard(value: unknown, maximum: number): CustomDashboard {
  const { name, title, metadata, rawItems } = dashboardHeader(value, maximum);
  const chartNames = new Set<string>();
  const items = rawItems.map(item => {
    if (!isRecord(item) || !isRecord(item.chart))
      throw new Error('Resolved dashboard items require a chart');
    keys(item, ['chart'], 'Dashboard item');
    const raw = item.chart;
    keys(
      raw,
      [
        'name',
        'metricName',
        'metrics',
        'unit',
        'dataType',
        'aggregator',
        'unitScale',
        'groupLabels',
        'min',
        'max',
        'spans',
        'aggregations',
      ],
      'Aggregate chart'
    );
    const name = text(raw.name, 256, 'Chart name');
    if (chartNames.has(name)) throw new Error('Dashboard chart names must be distinct');
    chartNames.add(name);
    const legacyName =
      raw.metricName === undefined || raw.metricName === null || raw.metricName === ''
        ? undefined
        : metricName(raw.metricName);
    const rawMetrics = raw.metrics ?? [];
    if (!Array.isArray(rawMetrics) || rawMetrics.length > 8)
      throw new Error('A dashboard chart supports at most 8 metric declarations');
    const displayNames = new Set<string>();
    const metrics = rawMetrics.map(item => {
      if (!isRecord(item)) throw new Error('Dashboard metrics require metricName and displayName');
      keys(item, ['metricName', 'displayName'], 'Dashboard metric');
      const displayName = text(item.displayName, 256, 'Metric display name');
      if (displayNames.has(displayName))
        throw new Error('Metric display names must be distinct within a chart');
      displayNames.add(displayName);
      return { metricName: metricName(item.metricName), displayName };
    });
    if (!metrics.length && !legacyName)
      throw new Error('A dashboard chart requires metrics or a legacy metricName');
    if (raw.dataType !== 'raw' && raw.dataType !== 'rate' && raw.dataType !== 'histogram')
      throw new Error('Custom aggregate charts support only raw, rate or histogram dataType');
    const groupLabels = metricGroupLabels(raw.groupLabels, raw.dataType === 'histogram');
    const aggregations = validateDashboardAggregations(raw.aggregations);
    const aggregator = raw.aggregator ?? 'sum';
    if (
      aggregator !== 'sum' &&
      aggregator !== 'avg' &&
      aggregator !== 'min' &&
      aggregator !== 'max'
    )
      throw new Error('Raw dashboard aggregation must be sum, avg, min or max');
    if (raw.dataType !== 'raw' && aggregator !== 'sum')
      throw new Error('Rate and histogram dashboard charts use sum aggregation');
    const scale = raw.unitScale ?? 1;
    if (typeof scale !== 'number' || !Number.isFinite(scale) || scale < 0 || scale > 1e12)
      throw new Error('Dashboard unitScale must be finite and between 0 and 1e12');
    return {
      chart: {
        name,
        ...validateChartDisplay(raw),
        ...(legacyName ? { metricName: legacyName } : {}),
        ...(raw.metrics !== undefined ? { metrics } : {}),
        ...(raw.groupLabels !== undefined ? { groupLabels } : {}),
        ...(raw.aggregations !== undefined ? { aggregations } : {}),
        ...(raw.unit === undefined || raw.unit === null || raw.unit === ''
          ? {}
          : { unit: text(raw.unit, 128, 'Chart unit') }),
        dataType: raw.dataType,
        aggregator,
        unitScale: scale === 0 ? 1 : scale,
      } satisfies CustomChart,
    };
  });
  return { name, title, ...metadata, items };
}
function dashboardReference(
  value: unknown
): { include: string; original: string; name: string; chartName?: string } | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > 1024)
    throw new Error('Dashboard include must be a string of at most 1024 characters');
  const include = trimGoSpace(value);
  if (!include) return null;
  const parts = include.split('$');
  if (
    parts.length > 2 ||
    parts[0].length > 128 ||
    /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.exec(parts[0])?.[0] !== parts[0]
  )
    throw new Error(
      'Dashboard includes require a template name with an optional $chart-name suffix'
    );
  return {
    include,
    original: value,
    name: parts[0],
    ...(parts.length === 2 ? { chartName: text(parts[1], 256, 'Included chart name') } : {}),
  };
}
export function validateCustomDashboardTemplate(value: unknown): CustomDashboardTemplate {
  const { name, title, metadata, rawItems } = dashboardHeader(value, 8, true);
  const names = new Set<string>();
  const items = rawItems.map(item => {
    if (!isRecord(item)) throw new Error('Dashboard items must be objects');
    keys(item, ['include', 'chart'], 'Dashboard item');
    const reference = dashboardReference(item.include);
    const chart =
      item.chart === undefined || item.chart === null
        ? undefined
        : validateCustomDashboard({ name, title, items: [{ chart: item.chart }] }).items[0].chart;
    if (!reference && !chart)
      throw new Error('Dashboard items require a chart or nonempty include');
    if (!reference && chart) {
      if (names.has(chart.name)) throw new Error('Dashboard chart names must be distinct');
      names.add(chart.name);
    }
    return { ...(reference ? { include: reference.original } : {}), ...(chart ? { chart } : {}) };
  });
  return { name, title, ...metadata, items };
}
export function isDashboardDisabled(template: CustomDashboardTemplate): boolean {
  return template.items.length === 0 && trimGoSpace(template.discoverOn ?? '') === '';
}
function dashboardTemplates(value: unknown, bundled = false): CustomDashboardTemplate[] {
  if (!Array.isArray(value) || value.length > (bundled ? MAX_EFFECTIVE_DASHBOARD_TEMPLATES : 20))
    throw new Error(
      bundled
        ? 'Effective dashboard catalog exceeds 41 templates'
        : 'At most 20 custom dashboard definitions can be saved per cluster'
    );
  const dashboards = value.map(validateCustomDashboardTemplate);
  if (
    JSON.stringify(dashboards).length >
    (bundled ? EFFECTIVE_DASHBOARD_BYTES : CUSTOM_DASHBOARD_BYTES)
  )
    throw new Error(
      bundled
        ? 'Effective dashboard catalog exceeds 128 KiB'
        : 'Custom dashboard definitions exceed 64 KiB of normalized JSON'
    );
  if (new Set(dashboards.map(dashboard => dashboard.name)).size !== dashboards.length)
    throw new Error('Custom dashboard names must be distinct');
  return dashboards;
}
export function validateDashboardCatalog(value: unknown): CustomDashboardTemplate[] {
  return dashboardTemplates(value, true).filter(template => !isDashboardDisabled(template));
}
export function resolveCustomDashboard(
  templates: readonly CustomDashboardTemplate[],
  selected: string
): { dashboard: CustomDashboard; references: { name: string; title: string }[] } {
  const parsed = validateDashboardCatalog(templates);
  const catalog = new Map(parsed.map(template => [template.name, template]));
  const visited = new Set<string>();
  const references: { name: string; title: string }[] = [];
  const resolve = (name: string): { chart: CustomChart }[] => {
    // Pinned Kiali retains visited templates across siblings, not just the recursion stack.
    if (visited.has(name)) throw new Error(`Repeated or circular dashboard include: ${name}`);
    visited.add(name);
    const template = catalog.get(name);
    if (!template) throw new Error(`Included dashboard is missing: ${name}`);
    references.push({ name, title: template.title });
    const charts: { chart: CustomChart }[] = [];
    for (const item of template.items) {
      const reference = dashboardReference(item.include);
      if (reference) {
        const included = resolve(reference.name);
        const matching =
          reference.chartName === undefined
            ? included
            : included.filter(item => item.chart.name === reference.chartName).slice(0, 1);
        if (!matching.length) throw new Error(`Included chart was not found: ${reference.include}`);
        charts.push(...matching);
      } else if (item.chart) {
        charts.push({ chart: item.chart });
      }
    }
    return charts;
  };
  const items = resolve(selected);
  if (!items.length) throw new Error('Dashboard template has no charts to load');
  const template = catalog.get(selected);
  if (!template) throw new Error('Selected dashboard is unavailable');
  return {
    dashboard: validateResolvedCustomDashboard({ ...template, items }),
    references,
  };
}
export function customChartMetrics(chart: CustomChart): CustomDashboardMetric[] {
  if (chart.metrics?.length) return chart.metrics.map(metric => ({ ...metric }));
  if (!chart.metricName) throw new Error('A dashboard chart has no effective metric');
  return [{ metricName: chart.metricName, displayName: chart.name }];
}
export function validateCustomDashboardSettings(value: unknown): CustomDashboardSettings {
  if (!isRecord(value)) throw new Error('Custom dashboard settings must be an object');
  keys(
    value,
    ['namespaceLabel', 'clusterLabel', 'dashboards', 'includeBuiltins'],
    'Custom dashboard settings'
  );
  if (value.includeBuiltins !== undefined && typeof value.includeBuiltins !== 'boolean')
    throw new Error('includeBuiltins must be a boolean');
  const namespaceLabel = dashboardLabel(value.namespaceLabel);
  const clusterLabel = value.clusterLabel === null ? null : dashboardLabel(value.clusterLabel);
  if (clusterLabel === namespaceLabel)
    throw new Error('Namespace and metric cluster labels must differ');
  const dashboards = dashboardTemplates(value.dashboards);
  return {
    namespaceLabel,
    clusterLabel,
    dashboards,
    ...(value.includeBuiltins !== undefined
      ? { includeBuiltins: value.includeBuiltins === true }
      : {}),
  };
}
export function customDashboardLabels(query: CustomDashboardScopeQuery): Record<string, string> {
  validateMetricTimeRange(query);
  if (!isDnsLabel(query.namespace)) throw new Error('Choose an explicit dashboard namespace');
  const namespaceLabel = dashboardLabel(query.namespaceLabel);
  const clusterLabel = query.clusterLabel === null ? null : dashboardLabel(query.clusterLabel);
  if (clusterLabel === namespaceLabel)
    throw new Error('Namespace and metric cluster labels must differ');
  if (clusterLabel) {
    text(query.metricCluster, 256, 'Metric cluster value');
    if (query.metricCluster.trim() !== query.metricCluster)
      throw new Error('Metric cluster value must not have surrounding whitespace');
  } else if (query.singleClusterConfirmed !== true) {
    throw new Error(
      'Confirm that the custom dashboard endpoint contains only one cluster before omitting its metric cluster filter'
    );
  }
  const additional = dashboardLabelFilters(query.labelsFilters, namespaceLabel, clusterLabel);
  return {
    [namespaceLabel]: query.namespace,
    ...(clusterLabel ? { [clusterLabel]: query.metricCluster } : {}),
    ...additional,
  };
}
export function customDashboardJobs(query: CustomDashboardQuery): CustomDashboardJob[] {
  const labels = customDashboardLabels(query);
  const dashboard = validateResolvedCustomDashboard(query.dashboard);
  const selected = dashboardChartSelection(query.chartNames, dashboard);
  const byLabels = dashboardByLabels(query.byLabels, dashboard);
  const selector = `{${metricSelector(labels)}}`;
  const charts = dashboard.items
    .map(({ chart }, chartIndex) => ({ chart, chartIndex }))
    .filter(item => selected.has(item.chart.name))
    .map(({ chart, chartIndex }) => ({
      chart,
      chartIndex,
      metrics: customChartMetrics(chart),
      groupLabels: metricGroupLabels(
        [...(chart.groupLabels ?? []), ...byLabels],
        chart.dataType === 'histogram'
      ),
    }));
  const count = charts.reduce(
    (sum, { chart, metrics }) =>
      sum +
      metrics.length * (chart.dataType === 'histogram' ? query.histogramSummaries?.length ?? 2 : 1),
    0
  );
  const budgetMessage =
    'Custom dashboards support at most 8 metric queries after expanding histogram summaries and metric declarations; reduce charts, metrics or selected summaries';
  if (count > 8) throw new Error(budgetMessage);
  const jobs = charts.flatMap<CustomDashboardJob>(({ chart, chartIndex, metrics, groupLabels }) =>
    metrics.flatMap<CustomDashboardJob>((metric, metricIndex) =>
      chart.dataType === 'histogram'
        ? histogramExpressions(
            metric.metricName,
            labels,
            query.histogramSummaries ?? ['avg', 'p95'],
            groupLabels
          ).map(({ summary, expression }) => ({
            key: `${chartIndex}:${metricIndex}:${summary}`,
            chart,
            chartIndex,
            groupLabels,
            metric,
            summary,
            expression,
          }))
        : [
            {
              key: `${chartIndex}:${metricIndex}:value`,
              chart,
              chartIndex,
              groupLabels,
              metric,
              expression:
                (chart.dataType === 'rate'
                  ? `sum(rate(${metric.metricName}${selector}[5m]))`
                  : `${chart.aggregator}(${metric.metricName}${selector})`) +
                (groupLabels.length ? ` by (${groupLabels.join(',')})` : ''),
            },
          ]
    )
  );
  if (jobs.length > 8) throw new Error(budgetMessage);
  jobs.forEach(job => metricRangeParameters(query, job.expression));
  return jobs;
}

export function dashboardChartSelection(value: unknown, dashboard: CustomDashboard): Set<string> {
  const names = new Set(dashboard.items.map(item => item.chart.name));
  if (value === undefined) return names;
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 8 ||
    new Set(value).size !== value.length ||
    value.some(name => typeof name !== 'string' || !names.has(name))
  )
    throw new Error('Choose 1 to 8 distinct chart names from the captured dashboard');
  return new Set(value);
}

export function dashboardLabelFilters(
  value: unknown,
  namespaceLabel: string,
  clusterLabel: string | null
): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value) || Object.keys(value).length > 10)
    throw new Error('Dashboard filters require an object with at most 10 equality labels');
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]): [string, string] => {
        dashboardLabel(key);
        if (key === namespaceLabel || key === clusterLabel)
          throw new Error(
            'Additional dashboard filters cannot replace the namespace or metric-cluster scope'
          );
        if (
          typeof value !== 'string' ||
          value.length > 1024 ||
          /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value)
        )
          throw new Error(
            'Dashboard label values must be strings of at most 1024 characters without controls or unpaired surrogates'
          );
        return [key, value];
      })
  );
}
