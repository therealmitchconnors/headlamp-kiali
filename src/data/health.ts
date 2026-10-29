import { ServiceEndpoint, validateServiceEndpoint } from '../core/config';
import {
  CalculatedHealth,
  calculateHealth,
  DEFAULT_HEALTH_RATES,
  HealthRateRule,
  validateHealthRules,
} from '../core/healthCalculator';
import { combinedMetricHealth } from '../core/healthReporters';
import { ClusterScope, clusterScope } from '../core/scope';
import { decodePrometheus } from '../core/telemetry';
import {
  healthRequestRates,
  healthWorkloadPath,
  workloadHealthQueries,
  WorkloadHealthQuery,
  WorkloadHealthResource,
  workloadHealthResource,
} from '../core/workloadHealth';
import {
  InvalidResponseError,
  readCluster,
  ReadFailure,
  readFailure,
  serviceProxyPath,
  withDiagnosticDeadline,
} from './requests';
import { MetricRead } from './telemetry';

export interface WorkloadHealthSnapshot {
  query: WorkloadHealthQuery;
  resource: { ok: true; result: WorkloadHealthResource } | { ok: false; error: ReadFailure };
  inbound: MetricRead;
  outbound: MetricRead;
  calculation: CalculatedHealth | null;
  calculationError?: ReadFailure;
}

export async function readHealthMetric(
  scope: ClusterScope,
  endpoint: ServiceEndpoint,
  query: string,
  end: number,
  signal: AbortSignal
): Promise<MetricRead> {
  try {
    const params = new URLSearchParams({ query, time: String(end) });
    const response = await readCluster(
      scope,
      `${serviceProxyPath(endpoint, '/api/v1/query')}?${params}`,
      signal
    );
    try {
      const result = decodePrometheus(response, 'vector');
      const identities = result.series.map(series =>
        JSON.stringify(Object.entries(series.labels).sort(([a], [b]) => a.localeCompare(b)))
      );
      if (new Set(identities).size !== identities.length)
        throw new Error('Duplicate request-health metric series');
      healthRequestRates(result);
      if (result.series.some(series => Math.abs(series.samples[0].timestamp - end) > 1))
        throw new Error('Request-health metric timestamp does not match the captured query time');
      return { ok: true, result };
    } catch (error) {
      throw new InvalidResponseError(
        error instanceof Error ? error.message : 'Invalid health metrics'
      );
    }
  } catch (error) {
    if (signal.aborted) throw error;
    return { ok: false, error: readFailure(error) };
  }
}

export async function loadWorkloadHealth(
  scope: ClusterScope,
  endpoint: ServiceEndpoint,
  query: WorkloadHealthQuery,
  customRules: readonly HealthRateRule[],
  signal: AbortSignal
): Promise<WorkloadHealthSnapshot> {
  signal.throwIfAborted();
  const capturedScope = clusterScope(scope.cluster);
  const capturedEndpoint = validateServiceEndpoint(endpoint);
  const capturedQuery = { ...query };
  const capturedRules = structuredClone(customRules);
  return withDiagnosticDeadline(
    signal,
    'Workload health reads exceeded 15 seconds',
    requestSignal =>
      readWorkloadHealth(
        capturedScope,
        capturedEndpoint,
        capturedQuery,
        capturedRules,
        requestSignal
      )
  );
}

async function readWorkloadHealth(
  scope: ClusterScope,
  endpoint: ServiceEndpoint,
  query: WorkloadHealthQuery,
  customRules: readonly HealthRateRule[],
  signal: AbortSignal
): Promise<WorkloadHealthSnapshot> {
  const rules = [...validateHealthRules(customRules), ...DEFAULT_HEALTH_RATES];
  const queries = workloadHealthQueries(query);
  async function workload(): Promise<WorkloadHealthSnapshot['resource']> {
    try {
      const response = await readCluster(scope, healthWorkloadPath(query), signal);
      try {
        return { ok: true, result: workloadHealthResource(response, query) };
      } catch (error) {
        throw new InvalidResponseError(
          error instanceof Error ? error.message : 'Invalid workload response'
        );
      }
    } catch (error) {
      if (signal.aborted) throw error;
      return { ok: false, error: readFailure(error) };
    }
  }
  const [resource, inbound, outbound] = await Promise.all([
    workload(),
    readHealthMetric(scope, endpoint, queries.inbound, query.end, signal),
    readHealthMetric(scope, endpoint, queries.outbound, query.end, signal),
  ]);
  const snapshot: WorkloadHealthSnapshot = {
    query,
    resource,
    inbound,
    outbound,
    calculation: null,
  };
  if (
    resource.ok &&
    resource.result.replicas &&
    !resource.result.stale &&
    inbound.ok &&
    outbound.ok &&
    !inbound.result.warnings.length &&
    !outbound.result.warnings.length &&
    (inbound.result.series.length || outbound.result.series.length)
  ) {
    try {
      snapshot.calculation = calculateHealth(
        {
          kind: 'workload',
          namespace: query.namespace,
          name: query.name,
          requests:
            query.reporterMode === 'combined'
              ? combinedMetricHealth(inbound.result, outbound.result)
              : {
                  inbound: healthRequestRates(inbound.result),
                  outbound: healthRequestRates(outbound.result),
                },
          annotations: resource.result.annotations,
          workloadStatuses: [resource.result.replicas],
        },
        rules
      );
    } catch (error) {
      snapshot.calculationError = readFailure(error);
    }
  }
  return snapshot;
}
