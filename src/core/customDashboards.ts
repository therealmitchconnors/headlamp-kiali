import { trimGoSpace } from './goStrings';
import { histogramExpressions, HistogramSummary } from './histograms';
import { metricRangeParameters, MetricTimeRange, validateMetricTimeRange } from './metricRanges';
import { isDnsLabel, isRecord } from './object';
import { metricSelector } from './telemetry';

export interface CustomChart {
  name: string;
  metricName?: string;
  metrics?: CustomDashboardMetric[];
  unit: string;
  dataType: 'raw' | 'rate' | 'histogram';
  aggregator?: 'sum' | 'avg' | 'min' | 'max';
  unitScale?: number;
}
export interface CustomDashboardMetric {
  metricName: string;
  displayName: string;
}
export interface CustomDashboard {
  name: string;
  title: string;
  items: { chart: CustomChart }[];
}
export interface CustomDashboardTemplate {
  name: string;
  title: string;
  items: { chart?: CustomChart; include?: string }[];
}
export interface CustomDashboardSettings {
  namespaceLabel: string;
  clusterLabel: string | null;
  dashboards: CustomDashboardTemplate[];
}
export interface CustomDashboardQuery extends MetricTimeRange {
  namespace: string;
  metricCluster: string;
  singleClusterConfirmed: boolean;
  namespaceLabel: string;
  clusterLabel: string | null;
  dashboard: CustomDashboard;
  histogramSummaries?: HistogramSummary[];
  labelsFilters?: Record<string, string>;
  templateReferences?: { name: string; title: string }[];
}
export interface CustomDashboardJob {
  key: string;
  chart: CustomChart;
  expression: string;
  summary?: HistogramSummary;
  chartIndex: number;
  metric: CustomDashboardMetric;
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
function metricName(value: unknown): string {
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
function dashboardHeader(value: unknown) {
  if (!isRecord(value)) throw new Error('A custom dashboard must be an object');
  keys(value, ['name', 'title', 'items'], 'Custom dashboard');
  const name = text(value.name, 128, 'Dashboard name');
  if (/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.exec(name)?.[0] !== name)
    throw new Error('Dashboard names require letters, digits, dot, underscore or hyphen');
  const title = text(value.title, 256, 'Dashboard title');
  if (!Array.isArray(value.items) || !value.items.length || value.items.length > 8)
    throw new Error(
      'Custom dashboards require 1 to 8 items and must resolve to 1 to 8 aggregate charts'
    );
  return { name, title, rawItems: value.items };
}
export function validateCustomDashboard(value: unknown): CustomDashboard {
  const { name, title, rawItems } = dashboardHeader(value);
  const chartNames = new Set<string>();
  const items = rawItems.map(item => {
    if (!isRecord(item) || !isRecord(item.chart))
      throw new Error('Resolved dashboard items require a chart');
    keys(item, ['chart'], 'Dashboard item');
    const raw = item.chart;
    keys(
      raw,
      ['name', 'metricName', 'metrics', 'unit', 'dataType', 'aggregator', 'unitScale'],
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
        ...(legacyName ? { metricName: legacyName } : {}),
        ...(raw.metrics !== undefined ? { metrics } : {}),
        unit: text(raw.unit, 128, 'Chart unit'),
        dataType: raw.dataType,
        aggregator,
        unitScale: scale === 0 ? 1 : scale,
      } satisfies CustomChart,
    };
  });
  return { name, title, items };
}
function dashboardReference(
  value: unknown
): { include: string; name: string; chartName?: string } | null {
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
    name: parts[0],
    ...(parts.length === 2 ? { chartName: text(parts[1], 256, 'Included chart name') } : {}),
  };
}
export function validateCustomDashboardTemplate(value: unknown): CustomDashboardTemplate {
  const { name, title, rawItems } = dashboardHeader(value);
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
    return { ...(reference ? { include: reference.include } : {}), ...(chart ? { chart } : {}) };
  });
  return { name, title, items };
}
function dashboardTemplates(value: unknown): CustomDashboardTemplate[] {
  if (!Array.isArray(value) || value.length > 20)
    throw new Error('At most 20 custom dashboard definitions can be saved per cluster');
  const dashboards = value.map(validateCustomDashboardTemplate);
  if (JSON.stringify(dashboards).length > 65536)
    throw new Error('Custom dashboard definitions exceed 64 KiB of normalized JSON');
  if (new Set(dashboards.map(dashboard => dashboard.name)).size !== dashboards.length)
    throw new Error('Custom dashboard names must be distinct');
  return dashboards;
}
export function resolveCustomDashboard(
  templates: readonly CustomDashboardTemplate[],
  selected: string
): { dashboard: CustomDashboard; references: { name: string; title: string }[] } {
  const parsed = dashboardTemplates(templates);
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
  const template = catalog.get(selected);
  if (!template) throw new Error('Selected dashboard is unavailable');
  return {
    dashboard: validateCustomDashboard({ name: template.name, title: template.title, items }),
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
  keys(value, ['namespaceLabel', 'clusterLabel', 'dashboards'], 'Custom dashboard settings');
  const namespaceLabel = dashboardLabel(value.namespaceLabel);
  const clusterLabel = value.clusterLabel === null ? null : dashboardLabel(value.clusterLabel);
  if (clusterLabel === namespaceLabel)
    throw new Error('Namespace and metric cluster labels must differ');
  const dashboards = dashboardTemplates(value.dashboards);
  return { namespaceLabel, clusterLabel, dashboards };
}
export function customDashboardJobs(query: CustomDashboardQuery): CustomDashboardJob[] {
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
  const dashboard = validateCustomDashboard(query.dashboard);
  const additional = dashboardLabelFilters(query.labelsFilters, namespaceLabel, clusterLabel);
  const labels = {
    [namespaceLabel]: query.namespace,
    ...(clusterLabel ? { [clusterLabel]: query.metricCluster } : {}),
    ...additional,
  };
  const selector = `{${metricSelector(labels)}}`;
  const charts = dashboard.items.map(({ chart }) => ({
    chart,
    metrics: customChartMetrics(chart),
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
  const jobs = charts.flatMap<CustomDashboardJob>(({ chart, metrics }, index) =>
    metrics.flatMap<CustomDashboardJob>((metric, metricIndex) =>
      chart.dataType === 'histogram'
        ? histogramExpressions(
            metric.metricName,
            labels,
            query.histogramSummaries ?? ['avg', 'p95']
          ).map(({ summary, expression }) => ({
            key: `${index}:${metricIndex}:${summary}`,
            chart,
            chartIndex: index,
            metric,
            summary,
            expression,
          }))
        : [
            {
              key: `${index}:${metricIndex}:value`,
              chart,
              chartIndex: index,
              metric,
              expression:
                chart.dataType === 'rate'
                  ? `sum(rate(${metric.metricName}${selector}[5m]))`
                  : `${chart.aggregator}(${metric.metricName}${selector})`,
            },
          ]
    )
  );
  if (jobs.length > 8) throw new Error(budgetMessage);
  jobs.forEach(job => metricRangeParameters(query, job.expression));
  return jobs;
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
