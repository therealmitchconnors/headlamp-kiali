import {
  getClusterConfig,
  KialiConfig,
  ServiceEndpoint,
  validateServiceEndpoint,
  validateTelemetryCluster,
} from './config';
import { isDnsLabel } from './object';

export interface ComparisonTarget {
  cluster: string;
  endpoint: ServiceEndpoint | null;
  telemetryCluster: string | null;
}
export interface ClusterComparisonQuery {
  namespace: string;
  end: number;
  targets: ComparisonTarget[];
}
export function captureClusterComparison(query: ClusterComparisonQuery): ClusterComparisonQuery {
  if (
    !isDnsLabel(query.namespace) ||
    !Number.isSafeInteger(query.end) ||
    query.end <= 0 ||
    query.end > 8640000000000 ||
    !Array.isArray(query.targets) ||
    !query.targets.length ||
    query.targets.length > 8
  )
    throw new Error('Cluster comparison requires a namespace, a captured time and 1 to 8 clusters');
  const seen = new Set<string>();
  const targets = query.targets.map(target => {
    if (
      typeof target.cluster !== 'string' ||
      !target.cluster.trim() ||
      target.cluster.length > 256 ||
      seen.has(target.cluster)
    )
      throw new Error('Cluster comparison targets must have distinct Headlamp identities');
    seen.add(target.cluster);
    return {
      cluster: target.cluster,
      endpoint: target.endpoint === null ? null : validateServiceEndpoint(target.endpoint),
      telemetryCluster:
        target.telemetryCluster === null ? null : validateTelemetryCluster(target.telemetryCluster),
    };
  });
  return { namespace: query.namespace, end: query.end, targets };
}
export function planClusterComparison(
  clusters: readonly string[],
  available: readonly string[],
  config: KialiConfig,
  namespace: string,
  end: number
): ClusterComparisonQuery {
  if (clusters.some(cluster => !available.includes(cluster)))
    throw new Error('A selected cluster is no longer available in Headlamp');
  return captureClusterComparison({
    namespace,
    end,
    targets: clusters.map(cluster => {
      const settings = getClusterConfig(config, cluster);
      return {
        cluster,
        endpoint: settings.prometheus,
        telemetryCluster: settings.telemetryCluster ?? null,
      };
    }),
  });
}
export function duplicateTelemetryIdentities(targets: readonly ComparisonTarget[]): string[] {
  const counts = new Map<string, number>();
  for (const target of targets)
    if (target.telemetryCluster)
      counts.set(target.telemetryCluster, (counts.get(target.telemetryCluster) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1).map(([identity]) => identity);
}
