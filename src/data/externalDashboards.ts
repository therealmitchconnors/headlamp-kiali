import {
  ExternalDashboardProvider,
  PersesDashboardConfig,
  validateExternalDashboards,
} from '../core/config';
import {
  buildExternalDashboardLink,
  decodeGrafanaDashboardSearch,
  decodePersesDashboard,
  ExternalDashboardContext,
  ExternalDashboardDiscovery,
  externalDashboardPath,
} from '../core/externalDashboards';
import { isRecord } from '../core/object';
import { ClusterScope, clusterScope } from '../core/scope';
import {
  InvalidResponseError,
  readCluster,
  serviceProxyPath,
  withDiagnosticDeadline,
} from './requests';

function providerConfig(provider: ExternalDashboardProvider, value: unknown) {
  const settings = validateExternalDashboards({ [provider]: value });
  const config = settings[provider];
  if (!config) throw new Error(`Configure ${provider} dashboard settings first`);
  return config;
}

function statusCode(error: unknown): number | undefined {
  return isRecord(error) && typeof error.status === 'number' ? error.status : undefined;
}

export async function discoverExternalDashboards(
  scope: ClusterScope,
  provider: ExternalDashboardProvider,
  value: unknown,
  context: ExternalDashboardContext,
  signal: AbortSignal
): Promise<ExternalDashboardDiscovery> {
  signal.throwIfAborted();
  const capturedScope = clusterScope(scope.cluster);
  const config = structuredClone(providerConfig(provider, value));
  const capturedContext = structuredClone(context);
  const dashboards = config.dashboards;
  return withDiagnosticDeadline(
    signal,
    `${provider === 'grafana' ? 'Grafana' : 'Perses'} dashboard discovery exceeded 15 seconds`,
    async requestSignal => {
      const discovered: ExternalDashboardDiscovery = {
        provider,
        dashboards: [],
        missing: [],
        capability: 'unverified',
      };
      for (const dashboard of dashboards) {
        requestSignal.throwIfAborted();
        const requestPath = externalDashboardPath(provider, config, dashboard);
        const separator = requestPath.indexOf('?');
        const suffix = separator < 0 ? requestPath : requestPath.slice(0, separator);
        const query = separator < 0 ? '' : requestPath.slice(separator);
        let response: unknown;
        try {
          response = await readCluster(
            capturedScope,
            `${serviceProxyPath(config.endpoint, suffix)}${query}`,
            requestSignal,
            { Accept: 'application/json' }
          );
        } catch (error) {
          if (provider === 'perses' && statusCode(error) === 404) {
            discovered.missing.push(dashboard.name);
            continue;
          }
          if (provider === 'grafana' && statusCode(error) === 404)
            throw new InvalidResponseError('Grafana search API is not supported at this endpoint');
          throw error;
        }
        requestSignal.throwIfAborted();
        try {
          let path: string | undefined;
          if (provider === 'grafana') {
            path = decodeGrafanaDashboardSearch(response, dashboard.name, config.externalURL);
          } else {
            const persesConfig = config as PersesDashboardConfig;
            decodePersesDashboard(response, persesConfig.project, dashboard.name);
            path = `/projects/${encodeURIComponent(persesConfig.project)}/dashboards/${encodeURIComponent(
              dashboard.name.toLowerCase().replace(/ /g, '-')
            )}`;
          }
          discovered.capability = 'verified';
          if (path) {
            discovered.dashboards.push({
              name: dashboard.name,
              url: buildExternalDashboardLink(provider, config, dashboard, path, capturedContext),
            });
          } else {
            discovered.missing.push(dashboard.name);
          }
        } catch (error) {
          throw new InvalidResponseError(
            error instanceof Error ? error.message : `Unsupported ${provider} dashboard response`
          );
        }
      }
      return discovered;
    }
  );
}
