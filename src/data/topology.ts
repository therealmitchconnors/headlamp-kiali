import { ServiceEndpoint } from '../core/config';
import { ClusterScope, clusterScope } from '../core/scope';
import { decodePrometheus } from '../core/telemetry';
import { decodeTopology, topologyQueries, TopologyQuery } from '../core/topology';
import {
  InvalidResponseError,
  readCluster,
  serviceProxyPath,
  withDiagnosticDeadline,
} from './requests';

export async function loadTopology(
  scope: ClusterScope,
  endpoint: ServiceEndpoint,
  query: TopologyQuery,
  signal: AbortSignal
) {
  const captured = Object.freeze({ ...query });
  const capturedScope = clusterScope(scope.cluster);
  const path = serviceProxyPath(endpoint, '/api/v1/query');
  const queries = topologyQueries(captured);
  return withDiagnosticDeadline(
    signal,
    'The topology read exceeded 15 seconds',
    async requestSignal => {
      const metrics = await Promise.all(
        queries.map(async expression => {
          const params = new URLSearchParams({
            query: expression.query,
            time: String(captured.end),
          });
          const response = await readCluster(capturedScope, `${path}?${params}`, requestSignal);
          try {
            return { metric: expression.metric, result: decodePrometheus(response, 'vector') };
          } catch (error) {
            throw new InvalidResponseError(
              error instanceof Error ? error.message : 'Invalid topology response'
            );
          }
        })
      );
      try {
        return { query: captured, ...decodeTopology(metrics, captured) };
      } catch (error) {
        throw new InvalidResponseError(
          error instanceof Error ? error.message : 'Invalid topology observations'
        );
      }
    }
  );
}
