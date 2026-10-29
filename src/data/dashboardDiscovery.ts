import { ServiceEndpoint, validateServiceEndpoint } from '../core/config';
import {
  DashboardDiscoveryQuery,
  dashboardDiscoveryRequest,
  decodeDashboardDiscovery,
} from '../core/dashboardDiscovery';
import { ClusterScope, clusterScope } from '../core/scope';
import {
  InvalidResponseError,
  readCluster,
  serviceProxyPath,
  withDiagnosticDeadline,
} from './requests';

export async function discoverCustomDashboards(
  scope: ClusterScope,
  endpoint: ServiceEndpoint,
  query: DashboardDiscoveryQuery,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const captured = structuredClone(query);
  const capturedScope = clusterScope(scope.cluster);
  const plan = dashboardDiscoveryRequest(captured);
  captured.templates = plan.templates;
  const path = serviceProxyPath(validateServiceEndpoint(endpoint), '/api/v1/query');
  return withDiagnosticDeadline(
    signal,
    'Dashboard discovery exceeded 15 seconds',
    async requestSignal => {
      const response = await readCluster(
        capturedScope,
        `${path}?${plan.parameters}`,
        requestSignal
      );
      requestSignal.throwIfAborted();
      try {
        return {
          query: captured,
          expression: plan.expression,
          ...decodeDashboardDiscovery(response, captured),
        };
      } catch (error) {
        throw new InvalidResponseError(
          error instanceof Error ? error.message : 'Invalid dashboard discovery response'
        );
      }
    }
  );
}
