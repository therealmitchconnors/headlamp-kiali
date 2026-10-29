import { ServiceEndpoint, validateServiceEndpoint } from '../core/config';
import { ClusterScope, clusterScope } from '../core/scope';
import {
  decodePrometheus,
  MetricResult,
  prometheusQueries,
  requestPoints,
  securityRates,
  trafficEdges,
  TrafficQuery,
} from '../core/telemetry';
import {
  InvalidResponseError,
  readCluster,
  ReadFailure,
  readFailure,
  serviceProxyPath,
  withDiagnosticDeadline,
} from './requests';

export type MetricRead = { ok: true; result: MetricResult } | { ok: false; error: ReadFailure };
export interface TelemetrySnapshot {
  query: TrafficQuery;
  requests: MetricRead;
  latency: MetricRead;
  tcp: MetricRead;
  traffic: MetricRead;
  security: MetricRead;
}

export async function loadTelemetry(
  scope: ClusterScope,
  endpoint: ServiceEndpoint,
  query: TrafficQuery,
  signal: AbortSignal
): Promise<TelemetrySnapshot> {
  signal.throwIfAborted();
  const capturedScope = clusterScope(scope.cluster);
  const capturedEndpoint = validateServiceEndpoint(endpoint);
  const capturedQuery = { ...query };
  return withDiagnosticDeadline(signal, 'Traffic metrics exceeded 15 seconds', requestSignal =>
    readTelemetry(capturedScope, capturedEndpoint, capturedQuery, requestSignal)
  );
}

async function readTelemetry(
  scope: ClusterScope,
  endpoint: ServiceEndpoint,
  query: TrafficQuery,
  signal: AbortSignal
): Promise<TelemetrySnapshot> {
  const queries = prometheusQueries(query);
  async function fetchMetric(key: keyof typeof queries): Promise<MetricRead> {
    try {
      const vector = key === 'traffic' || key === 'security';
      const params = new URLSearchParams({ query: queries[key] });
      if (vector) params.set('time', String(query.end));
      else {
        params.set('start', String(query.end - query.minutes * 60));
        params.set('end', String(query.end));
        params.set('step', '15');
      }
      const response = await readCluster(
        scope,
        `${serviceProxyPath(endpoint, vector ? '/api/v1/query' : '/api/v1/query_range')}?${params}`,
        signal
      );
      try {
        const result = decodePrometheus(response, vector ? 'vector' : 'matrix');
        if (key === 'requests') requestPoints(result);
        if (key === 'traffic') trafficEdges(result);
        if (key === 'security') securityRates(result);
        if ((key === 'latency' || key === 'tcp') && result.series.length > 1) {
          throw new Error('Expected one aggregated metric series');
        }
        return { ok: true, result };
      } catch (error) {
        throw new InvalidResponseError(
          error instanceof Error ? error.message : 'Invalid metric response'
        );
      }
    } catch (error) {
      if (signal.aborted) throw error;
      return { ok: false, error: readFailure(error) };
    }
  }
  const [requests, latency, tcp] = await Promise.all(
    (['requests', 'latency', 'tcp'] as const).map(fetchMetric)
  );
  const [traffic, security] = await Promise.all([fetchMetric('traffic'), fetchMetric('security')]);
  return { query, requests, latency, tcp, traffic, security };
}
