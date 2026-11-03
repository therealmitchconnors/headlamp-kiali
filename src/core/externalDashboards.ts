import {
  ExternalDashboardDefinition,
  ExternalDashboardProvider,
  ExternalDashboardVariables,
  GrafanaDashboardConfig,
  PersesDashboardConfig,
} from './config';
import { isRecord } from './object';

export type ExternalDashboardConfig = GrafanaDashboardConfig | PersesDashboardConfig;

export interface ExternalDashboardContext {
  cluster?: string;
  namespace?: string;
  application?: string;
  service?: string;
  workload?: string;
  version?: string;
  start: number;
  end: number;
}

export interface DiscoveredExternalDashboard {
  name: string;
  url: string;
}

export interface ExternalDashboardDiscovery {
  provider: ExternalDashboardProvider;
  capability: 'verified' | 'unverified';
  dashboards: DiscoveredExternalDashboard[];
  missing: string[];
}

export function persesDashboardID(name: string): string {
  return name.toLowerCase().replace(/ /g, '-');
}

export function externalDashboardPath(
  provider: ExternalDashboardProvider,
  config: ExternalDashboardConfig,
  dashboard: ExternalDashboardDefinition
): string {
  if (provider === 'grafana') {
    const parameters = new URLSearchParams({ query: dashboard.name });
    return `/api/search?${parameters.toString()}`;
  }
  const perses = config as PersesDashboardConfig;
  return `/api/v1/projects/${encodeURIComponent(perses.project)}/dashboards/${encodeURIComponent(
    persesDashboardID(dashboard.name)
  )}`;
}

function dashboardPathFromGrafana(value: unknown, externalURL: string): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 2048 ||
    /[\u0000-\u001f\u007f\\]/.test(value)
  )
    throw new Error('Grafana dashboard URL is missing or malformed');
  let base: URL;
  let dashboard: URL;
  try {
    base = new URL(externalURL);
    dashboard = new URL(value, `${base.origin}/`);
  } catch {
    throw new Error('Grafana dashboard URL is malformed');
  }
  if (
    dashboard.origin !== base.origin ||
    dashboard.username ||
    dashboard.password ||
    dashboard.search ||
    dashboard.hash ||
    !dashboard.pathname.startsWith('/') ||
    dashboard.pathname.startsWith('//')
  )
    throw new Error('Grafana dashboard URL is not a safe path on the configured host');
  const basePath = base.pathname.replace(/\/+$/, '');
  const dashboardPath =
    basePath && dashboard.pathname !== basePath && !dashboard.pathname.startsWith(`${basePath}/`)
      ? `${basePath}/${dashboard.pathname.replace(/^\/+/, '')}`
      : dashboard.pathname;
  if (dashboardPath.split('/').some(part => part === '.' || part === '..'))
    throw new Error('Grafana dashboard URL contains an unsafe path');
  return dashboardPath;
}

export function decodeGrafanaDashboardSearch(
  response: unknown,
  name: string,
  externalURL: string
): string | undefined {
  if (!Array.isArray(response) || response.length > 1000)
    throw new Error('Grafana search API did not return a supported dashboard list');
  const matches = response.filter(
    item => isRecord(item) && item.title === name && item.type !== 'dash-folder'
  );
  if (!matches.length) return undefined;
  if (matches.length !== 1)
    throw new Error(`Grafana dashboard "${name}" is ambiguous`);
  return dashboardPathFromGrafana(matches[0].url, externalURL);
}

export function decodePersesDashboard(response: unknown, project: string, name: string): boolean {
  const dashboardID = persesDashboardID(name);
  if (
    !isRecord(response) ||
    !isRecord(response.metadata) ||
    response.metadata.name !== dashboardID ||
    response.metadata.project !== project ||
    (response.kind !== undefined && response.kind !== 'Dashboard')
  )
    throw new Error('Perses API returned an unsupported dashboard identity');
  return true;
}

function dashboardPathFromPerses(value: string, externalURL: string): string {
  if (
    !/^\/projects\/[A-Za-z0-9._~-]+\/dashboards\/[A-Za-z0-9._~-]+$/.test(value) ||
    value.split('/').some(part => part === '.' || part === '..')
  )
    throw new Error('Perses dashboard URL is not a safe dashboard path');
  const basePath = new URL(externalURL).pathname.replace(/\/+$/, '');
  return `${basePath}${value}`;
}

function variableValues(
  provider: ExternalDashboardProvider,
  config: ExternalDashboardConfig,
  mapping: ExternalDashboardVariables,
  context: ExternalDashboardContext
): [string, string][] {
  const datasource = provider === 'grafana' ? (config as GrafanaDashboardConfig).datasourceUID : (config as PersesDashboardConfig).project;
  const service =
    context.service === undefined
      ? undefined
      : context.service === ''
      ? ''
      : `${context.service}.${context.namespace ?? ''}.svc.cluster.local`;
  const values: Record<keyof ExternalDashboardVariables, string | undefined> = {
    app: context.application,
    cluster: context.cluster,
    datasource,
    namespace: context.namespace,
    service,
    version: context.version,
    workload: context.workload,
  };
  return (Object.keys(mapping) as (keyof ExternalDashboardVariables)[]).flatMap(field => {
    const parameter = mapping[field];
    const value = values[field];
    return parameter !== undefined && value !== undefined ? [[parameter, value]] : [];
  });
}

export function buildExternalDashboardLink(
  provider: ExternalDashboardProvider,
  config: ExternalDashboardConfig,
  dashboard: ExternalDashboardDefinition,
  discoveredPath: string,
  context: ExternalDashboardContext
): string {
  if (
    !Number.isSafeInteger(context.start) ||
    !Number.isSafeInteger(context.end) ||
    context.start > 8_640_000_000_000_000 ||
    context.end > 8_640_000_000_000_000 ||
    context.start < 0 ||
    context.start >= context.end
  )
    throw new Error('A valid historical dashboard time range is required');
  const base = new URL(config.externalURL);
  const path =
    provider === 'grafana'
      ? dashboardPathFromGrafana(discoveredPath, config.externalURL)
      : dashboardPathFromPerses(discoveredPath, config.externalURL);
  const link = new URL(path, `${base.origin}/`);
  if (link.origin !== base.origin) throw new Error('Dashboard link left the configured provider host');
  for (const [parameter, value] of variableValues(
    provider,
    config,
    dashboard.variables,
    context
  ))
    link.searchParams.set(parameter, value);
  if (provider === 'grafana') {
    link.searchParams.set('from', String(context.start));
    link.searchParams.set('to', String(context.end));
  } else {
    link.searchParams.set('start', new Date(context.start).toISOString());
    link.searchParams.set('end', new Date(context.end).toISOString());
  }
  return link.toString();
}
