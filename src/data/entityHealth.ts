import { ServiceEndpoint, validateServiceEndpoint } from '../core/config';
import { Application, correlateResources } from '../core/correlation';
import {
  applicationReplicaEvidence,
  entityHealthQueries,
  EntityHealthQuery,
  serviceHealthResource,
} from '../core/entityHealth';
import { WorkloadStatus } from '../core/health';
import {
  CalculatedHealth,
  calculateHealth,
  DEFAULT_HEALTH_RATES,
  HealthRateRule,
  validateHealthRules,
} from '../core/healthCalculator';
import { combinedMetricHealth } from '../core/healthReporters';
import { AppLabels } from '../core/labels';
import { ClusterScope, clusterScope, namespaceScope } from '../core/scope';
import { healthRequestRates } from '../core/workloadHealth';
import { loadCorrelationSnapshot } from './correlation';
import { readHealthMetric } from './health';
import {
  InvalidResponseError,
  readCluster,
  ReadFailure,
  readFailure,
  withDiagnosticDeadline,
} from './requests';
import { MetricRead } from './telemetry';

export interface EntityHealthSnapshot {
  query: EntityHealthQuery;
  application?: Application;
  issues: string[];
  resourceError?: ReadFailure;
  inbound?: MetricRead;
  outbound?: MetricRead;
  calculation: CalculatedHealth | null;
}

export async function loadEntityHealth(
  scope: ClusterScope,
  endpoint: ServiceEndpoint,
  query: EntityHealthQuery,
  customRules: readonly HealthRateRule[],
  appLabels: AppLabels | null,
  signal: AbortSignal
): Promise<EntityHealthSnapshot> {
  signal.throwIfAborted();
  const capturedScope = clusterScope(scope.cluster);
  const capturedEndpoint = validateServiceEndpoint(endpoint);
  const capturedQuery = { ...query };
  const capturedRules = structuredClone(customRules);
  const capturedLabels = appLabels ? { ...appLabels } : null;
  return withDiagnosticDeadline(signal, 'Entity health reads exceeded 15 seconds', requestSignal =>
    readEntityHealth(
      capturedScope,
      capturedEndpoint,
      capturedQuery,
      capturedRules,
      capturedLabels,
      requestSignal
    )
  );
}

async function readEntityHealth(
  scope: ClusterScope,
  endpoint: ServiceEndpoint,
  query: EntityHealthQuery,
  customRules: readonly HealthRateRule[],
  appLabels: AppLabels | null,
  signal: AbortSignal
): Promise<EntityHealthSnapshot> {
  const queries = entityHealthQueries(query);
  const rules = [...validateHealthRules(customRules), ...DEFAULT_HEALTH_RATES];
  const result: EntityHealthSnapshot = { query, issues: [], calculation: null };
  let annotations: Record<string, string> = {};
  let replicas: WorkloadStatus[] | undefined;
  try {
    if (query.kind === 'Application') {
      const snapshot = await loadCorrelationSnapshot(
        namespaceScope(scope.cluster, query.namespace),
        signal
      );
      const correlation = correlateResources(snapshot.resources, appLabels);
      result.application = correlation.applications.find(app => app.name === query.name);
      if (!snapshot.complete)
        result.issues.push(
          ...snapshot.sources
            .filter(source => !source.complete)
            .map(
              source =>
                `${source.source.kind}: ${
                  source.error?.message ?? 'Resource collection limit reached'
                }`
            )
        );
      if (correlation.issues.length)
        result.issues.push('Application ownership relationships are incomplete');
      if (!result.application) {
        result.issues.push(
          snapshot.complete
            ? 'No application with this label was found in the selected namespace'
            : 'Application membership could not be established from incomplete resource reads'
        );
      } else {
        const evidence = applicationReplicaEvidence(result.application);
        result.issues.push(...evidence.issues);
        replicas = evidence.statuses;
      }
    } else {
      const resource = await readCluster(
        scope,
        `/api/v1/namespaces/${encodeURIComponent(query.namespace)}/services/${encodeURIComponent(
          query.name
        )}`,
        signal
      );
      try {
        annotations = serviceHealthResource(resource, query).annotations;
      } catch (error) {
        throw new InvalidResponseError(
          error instanceof Error ? error.message : 'Invalid Service health resource'
        );
      }
    }
  } catch (error) {
    if (signal.aborted) throw error;
    result.resourceError = readFailure(error);
  }
  if (result.resourceError || result.issues.length) return result;
  const [inbound, outbound] = await Promise.all([
    readHealthMetric(scope, endpoint, queries.inbound, query.end, signal),
    queries.outbound
      ? readHealthMetric(scope, endpoint, queries.outbound, query.end, signal)
      : undefined,
  ]);
  result.inbound = inbound;
  result.outbound = outbound;
  if (!inbound.ok || (outbound && !outbound.ok)) return result;
  if (inbound.result.warnings.length || (outbound?.ok && outbound.result.warnings.length)) {
    result.issues.push('Prometheus returned warnings; health observations may be incomplete');
    return result;
  }
  if (!inbound.result.series.length && !(outbound?.ok && outbound.result.series.length)) {
    result.issues.push('Request telemetry is missing; no healthy status was inferred');
    return result;
  }
  try {
    result.calculation = calculateHealth(
      {
        kind: query.kind === 'Application' ? 'app' : 'service',
        name: query.name,
        namespace: query.namespace,
        workloadStatuses: replicas,
        annotations,
        requests:
          query.reporterMode === 'combined'
            ? combinedMetricHealth(inbound.result, outbound?.ok ? outbound.result : undefined)
            : {
                inbound: healthRequestRates(inbound.result),
                outbound: outbound?.ok ? healthRequestRates(outbound.result) : undefined,
              },
      },
      rules
    );
  } catch (error) {
    result.issues.push(error instanceof Error ? error.message : 'Health calculation failed');
  }
  return result;
}
