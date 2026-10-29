import {
  customDashboardLabels,
  CustomDashboardScopeQuery,
  CustomDashboardTemplate,
  MAX_EFFECTIVE_DASHBOARD_TEMPLATES,
  metricName,
  validateDashboardCatalog,
} from './customDashboards';
import type { DashboardOrigin } from './dashboardCatalog';
import { compareGoStrings } from './goStrings';
import { decodePrometheus, metricSelector } from './telemetry';

export interface DashboardDiscoveryQuery extends CustomDashboardScopeQuery {
  templates: CustomDashboardTemplate[];
  templateSources?: { name: string; origin: DashboardOrigin }[];
}
export interface DashboardRuntime {
  name: string;
  dashboards: { name: string; title: string; discoverOn: string }[];
}

export function dashboardDiscoveryRequest(query: DashboardDiscoveryQuery) {
  const labels = customDashboardLabels(query);
  const templates = validateDashboardCatalog(query.templates);
  if (!templates.some(template => template.discoverOn))
    throw new Error('Configure at least one discoverOn metric before discovering dashboards');
  const expression = `count({${metricSelector(labels)}}) by (__name__)`;
  const parameters = new URLSearchParams({ query: expression, time: String(query.end) });
  if (parameters.toString().length > 16384)
    throw new Error('Encoded dashboard discovery query parameters exceed 16 KiB');
  return { templates, expression, parameters: parameters.toString() };
}

export function matchDashboardRuntimes(
  templates: readonly CustomDashboardTemplate[],
  metricNames: readonly string[]
): DashboardRuntime[] {
  if (templates.length > MAX_EFFECTIVE_DASHBOARD_TEMPLATES || metricNames.length > 2000)
    throw new Error('Dashboard discovery exceeds its template or metric-name budget');
  const names = new Set(metricNames);
  const matched = templates.filter(
    template => template.discoverOn && names.has(template.discoverOn)
  );
  // Discovery suppresses literal direct includes; composition separately trims and resolves them.
  const suppressed = new Set(
    matched.flatMap(template =>
      template.items.flatMap(item => (item.include ? [item.include] : []))
    )
  );
  const runtimes = new Map<string, DashboardRuntime>();
  for (const template of matched) {
    if (suppressed.has(template.name) || !template.discoverOn) continue;
    const name = template.runtime ?? '';
    const runtime = runtimes.get(name) ?? { name, dashboards: [] };
    runtime.dashboards.push({
      name: template.name,
      title: template.title,
      discoverOn: template.discoverOn,
    });
    runtimes.set(name, runtime);
  }
  return [...runtimes.values()]
    .sort((a, b) => compareGoStrings(a.name, b.name))
    .map(runtime => ({
      ...runtime,
      dashboards: runtime.dashboards.sort((a, b) => compareGoStrings(a.name, b.name)),
    }));
}

export function decodeDashboardDiscovery(response: unknown, query: DashboardDiscoveryQuery) {
  const plan = dashboardDiscoveryRequest(query);
  const result = decodePrometheus(response, 'vector');
  const names = result.series.map(series => {
    if (
      Object.keys(series.labels).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(series.labels, '__name__')
    )
      throw new Error('Dashboard discovery requires only the __name__ aggregation label');
    const name = metricName(series.labels.__name__);
    if (series.samples.length !== 1 || Math.abs(series.samples[0].timestamp - query.end) > 1)
      throw new Error('Dashboard discovery response does not match the captured instant');
    return name;
  });
  if (new Set(names).size !== names.length)
    throw new Error('Dashboard discovery returned duplicate metric names');
  const wanted = new Set(
    plan.templates.flatMap(template => (template.discoverOn ? [template.discoverOn] : []))
  );
  const observed = names.filter(name => wanted.has(name)).sort(compareGoStrings);
  return {
    runtimes: matchDashboardRuntimes(plan.templates, observed),
    observed,
    warnings: result.warnings,
  };
}
