import {
  captureClusterComparison,
  ClusterComparisonQuery,
  ComparisonTarget,
  normalizeComparisonStores,
  NormalizedTelemetryStore,
} from '../core/clusterComparison';
import { isRecord } from '../core/object';
import { clusterScope } from '../core/scope';
import { decodePrometheus, requestPoints, requestRateQuery } from '../core/telemetry';
import {
  discoverIstio,
  InvalidResponseError,
  readCluster,
  ReadFailure,
  readFailure,
  serviceProxyPath,
  withDiagnosticDeadline,
} from './requests';

const MAX_COMPARISON_SERIES = 2000;
const MAX_COMPARISON_SAMPLES_PER_SERIES = 241;

type Observation<T> =
  | { status: 'ready'; value: T }
  | { status: 'error'; error: ReadFailure }
  | { status: 'not-configured' };
export interface ComparedCluster {
  target: ComparisonTarget;
  namespace: Observation<{ uid: string }>;
  istio: Observation<{ versions: string[] }>;
  metrics: Observation<{ points: ReturnType<typeof requestPoints>; warnings: string[] }>;
}
export interface ClusterComparisonSnapshot {
  query: ClusterComparisonQuery;
  clusters: ComparedCluster[];
  stores: NormalizedTelemetryStore[];
}
export async function loadClusterComparison(
  input: ClusterComparisonQuery,
  signal: AbortSignal
): Promise<ClusterComparisonSnapshot> {
  signal.throwIfAborted();
  const query = captureClusterComparison(input);
  const clusters: ComparedCluster[] = new Array(query.targets.length);
  let next = 0;
  async function targetRead(target: ComparisonTarget): Promise<ComparedCluster> {
    const pending = {
      status: 'error' as const,
      error: { kind: 'unavailable' as const, message: 'Observation did not complete' },
    };
    const result: ComparedCluster = {
      target,
      namespace: pending,
      istio: pending,
      metrics: target.endpoint && target.telemetryCluster ? pending : { status: 'not-configured' },
    };
    const scope = clusterScope(target.cluster);
    try {
      await withDiagnosticDeadline(
        signal,
        'Cluster comparison exceeded 15 seconds for this target',
        async requestSignal => {
          async function observe<T>(read: () => Promise<T>): Promise<Observation<T>> {
            try {
              const value = await read();
              requestSignal.throwIfAborted();
              return { status: 'ready', value };
            } catch (error) {
              if (requestSignal.aborted) throw error;
              return { status: 'error', error: readFailure(error) };
            }
          }
          result.istio = await observe(() => discoverIstio(scope, requestSignal));
          result.namespace = await observe(async () => {
            const value = await readCluster(
              scope,
              `/api/v1/namespaces/${query.namespace}`,
              requestSignal
            );
            if (
              !isRecord(value) ||
              value.kind !== 'Namespace' ||
              value.apiVersion !== 'v1' ||
              !isRecord(value.metadata) ||
              value.metadata.name !== query.namespace ||
              typeof value.metadata.uid !== 'string' ||
              !value.metadata.uid
            )
              throw new InvalidResponseError('Namespace observation has an unexpected identity');
            return { uid: value.metadata.uid };
          });
          if (target.endpoint && target.telemetryCluster) {
            const endpoint = target.endpoint;
            const expression = requestRateQuery({
              reporter: 'destination',
              destination_cluster: target.telemetryCluster,
              destination_workload_namespace: query.namespace,
            });
            result.metrics = await observe(async () => {
              const params = new URLSearchParams({
                query: expression,
                start: String(query.start),
                end: String(query.end),
                step: String(query.step),
              });
              const response = await readCluster(
                scope,
                `${serviceProxyPath(endpoint, '/api/v1/query_range')}?${params}`,
                requestSignal
              );
              try {
                const metric = decodePrometheus(response, 'matrix');
                if (
                  metric.series.length > MAX_COMPARISON_SERIES ||
                  metric.series.some(
                    series =>
                      Object.keys(series.labels).some(
                        label =>
                          !['request_protocol', 'response_code', 'grpc_response_status'].includes(
                            label
                          )
                      ) ||
                      series.samples.length > MAX_COMPARISON_SAMPLES_PER_SERIES ||
                      series.samples.some(
                        sample =>
                          sample.timestamp < query.start ||
                          sample.timestamp > query.end ||
                          Math.abs((sample.timestamp - query.start) % query.step) > 0.001
                      )
                  )
                )
                  throw new Error('Comparison rates exceeded their series or range bounds');
                return { points: requestPoints(metric), warnings: metric.warnings };
              } catch (error) {
                throw new InvalidResponseError(
                  error instanceof Error ? error.message : 'Invalid comparison rates'
                );
              }
            });
          }
        }
      );
    } catch (error) {
      if (signal.aborted) throw error;
      const failure = { status: 'error' as const, error: readFailure(error) };
      if (result.istio === pending) result.istio = failure;
      if (result.namespace === pending) result.namespace = failure;
      if (result.metrics === pending) result.metrics = failure;
    }
    return result;
  }
  async function worker() {
    while (next < query.targets.length) {
      signal.throwIfAborted();
      const index = next++;
      clusters[index] = await targetRead(query.targets[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, query.targets.length) }, worker));
  signal.throwIfAborted();
  const stores = normalizeComparisonStores(
    clusters.map(({ target, metrics }) => ({ target, metrics })),
    (query.end - query.start) / query.step + 1
  );
  return { query, clusters, stores };
}
