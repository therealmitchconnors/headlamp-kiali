import {
  getClusterConfig,
  KialiConfig,
  ServiceEndpoint,
  validateMeshClusterName,
  validateServiceEndpoint,
  validateTelemetryCluster,
  validateTelemetryStore,
} from './config';
import { isDnsLabel } from './object';
import { RequestPoint } from './telemetry';

export interface ComparisonTarget {
  cluster: string;
  endpoint: ServiceEndpoint | null;
  meshClusterName: string | null;
  telemetryCluster: string | null;
  telemetryStore: string | null;
}
export interface ClusterComparisonQuery {
  namespace: string;
  start: number;
  end: number;
  step: number;
  targets: ComparisonTarget[];
}
export type ComparisonMetricObservation =
  | { status: 'ready'; value: { points: RequestPoint[]; warnings: string[] } }
  | { status: 'error'; error: { kind: string; message: string; status?: number } }
  | { status: 'not-configured' };
export interface ComparisonMetricSource {
  target: ComparisonTarget;
  metrics: ComparisonMetricObservation;
}
export interface NormalizedTelemetryStore {
  identity: string;
  kind: 'context' | 'shared';
  sourceClusters: string[];
  sourceMappings: ComparisonTarget[];
  status: 'ready' | 'incomplete' | 'ambiguous';
  points: RequestPoint[];
  duplicates: { cluster: string; duplicateOf: string }[];
  reason?: string;
}

export function captureClusterComparison(query: ClusterComparisonQuery): ClusterComparisonQuery {
  const duration = query.end - query.start;
  if (
    !isDnsLabel(query.namespace) ||
    !Number.isSafeInteger(query.start) ||
    !Number.isSafeInteger(query.end) ||
    query.start <= 0 ||
    query.end <= query.start ||
    duration < 15 * 60 ||
    duration > 4 * 60 * 60 ||
    duration % 60 !== 0 ||
    query.step !== 60 ||
    !Array.isArray(query.targets) ||
    !query.targets.length ||
    query.targets.length > 8
  )
    throw new Error(
      'Cluster comparison requires a namespace, a 15-minute to 4-hour range and 1 to 8 clusters'
    );
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
      meshClusterName:
        target.meshClusterName === null || target.meshClusterName === undefined
          ? null
          : validateMeshClusterName(target.meshClusterName),
      telemetryCluster:
        target.telemetryCluster === null || target.telemetryCluster === undefined
          ? null
          : validateTelemetryCluster(target.telemetryCluster),
      telemetryStore:
        target.telemetryStore === null || target.telemetryStore === undefined
          ? null
          : validateTelemetryStore(target.telemetryStore),
    };
  });
  return { namespace: query.namespace, start: query.start, end: query.end, step: query.step, targets };
}

export function planClusterComparison(
  clusters: readonly string[],
  available: readonly string[],
  config: KialiConfig,
  namespace: string,
  start: number,
  end: number
): ClusterComparisonQuery {
  if (clusters.some(cluster => !available.includes(cluster)))
    throw new Error('A selected cluster is no longer available in Headlamp');
  return captureClusterComparison({
    namespace,
    start,
    end,
    step: 60,
    targets: clusters.map(cluster => {
      const settings = getClusterConfig(config, cluster);
      return {
        cluster,
        endpoint: settings.prometheus,
        meshClusterName: settings.meshClusterName ?? null,
        telemetryCluster: settings.telemetryCluster ?? null,
        telemetryStore: settings.telemetryStore ?? null,
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

export function normalizeComparisonStores(
  sources: readonly ComparisonMetricSource[],
  expectedSamples = 1
): NormalizedTelemetryStore[] {
  if (!Number.isSafeInteger(expectedSamples) || expectedSamples < 1 || expectedSamples > 241)
    throw new Error('Normalized telemetry sample count must be between 1 and 241');
  const groups = new Map<string, { kind: 'context' | 'shared'; identity: string; sources: ComparisonMetricSource[] }>();
  for (const source of sources) {
    const kind = source.target.telemetryStore ? 'shared' : 'context';
    const identity = source.target.telemetryStore ?? source.target.cluster;
    const key = JSON.stringify([kind, identity]);
    const group = groups.get(key) ?? { kind, identity, sources: [] };
    group.sources.push(source);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ kind, identity, sources: members }) => {
    const result: NormalizedTelemetryStore = {
      identity,
      kind,
      sourceClusters: members.map(({ target }) => target.cluster),
      sourceMappings: members.map(({ target }) => target),
      status: 'incomplete',
      points: [],
      duplicates: [],
    };
    const endpointKeys = new Set(
      members.flatMap(({ target }) => (target.endpoint ? [JSON.stringify(target.endpoint)] : []))
    );
    if (kind === 'shared' && endpointKeys.size > 1) {
      result.status = 'ambiguous';
      result.reason = 'Shared store identity maps to different Prometheus endpoints';
      return result;
    }

    const byTelemetryCluster = new Map<string, ComparisonMetricSource[]>();
    for (const member of members) {
      if (!member.target.endpoint || !member.target.telemetryCluster) continue;
      const list = byTelemetryCluster.get(member.target.telemetryCluster) ?? [];
      list.push(member);
      byTelemetryCluster.set(member.target.telemetryCluster, list);
    }
    if (
      members.some(
        ({ target, metrics }) =>
          !target.endpoint ||
          !target.telemetryCluster ||
          metrics.status !== 'ready' ||
          metrics.value.warnings.length > 0 ||
          metrics.value.points.length !== expectedSamples
      ) ||
      byTelemetryCluster.size === 0
    ) {
      result.reason = 'Every selected source needs a complete endpoint, metric identity and range';
      return result;
    }

    const unique: ComparisonMetricObservation[] = [];
    for (const [telemetryCluster, sameIdentity] of byTelemetryCluster) {
      const first = sameIdentity[0];
      if (first.metrics.status !== 'ready') continue;
      for (const duplicate of sameIdentity.slice(1)) {
        if (
          duplicate.metrics.status !== 'ready' ||
          JSON.stringify(duplicate.metrics.value.points) !==
            JSON.stringify(first.metrics.value.points)
        ) {
          result.status = 'ambiguous';
          result.reason = `Shared telemetry identity ${telemetryCluster} returned conflicting samples`;
          return result;
        }
        result.duplicates.push({
          cluster: duplicate.target.cluster,
          duplicateOf: first.target.cluster,
        });
      }
      unique.push(first.metrics);
    }
    if (unique.length !== byTelemetryCluster.size) {
      result.reason = 'At least one telemetry source did not complete';
      return result;
    }
    const firstPoints = (unique[0] as Extract<ComparisonMetricObservation, { status: 'ready' }>)
      .value.points;
    if (
      unique.some(
        observation =>
          observation.status !== 'ready' ||
          JSON.stringify(observation.value.points.map(point => point.timestamp)) !==
            JSON.stringify(firstPoints.map(point => point.timestamp))
      )
    ) {
      result.reason = 'Telemetry sources did not return aligned range samples';
      return result;
    }
    if (
      unique.some(
        observation =>
          observation.status !== 'ready' ||
          observation.value.points.some(point => point.requests === null || point.errors === null)
      )
    ) {
      result.reason = 'At least one telemetry sample is unavailable';
      return result;
    }
    result.points = firstPoints.map((point, index) => {
      const samples = unique.map(
        observation =>
          (observation as Extract<ComparisonMetricObservation, { status: 'ready' }>).value.points[
            index
          ]
      );
      const requests =
        samples.every(sample => sample.requests !== null) &&
        Number.isFinite(samples.reduce((total, sample) => total + (sample.requests ?? 0), 0))
          ? samples.reduce((total, sample) => total + sample.requests!, 0)
          : null;
      const errors =
        samples.every(sample => sample.errors !== null) &&
        Number.isFinite(samples.reduce((total, sample) => total + (sample.errors ?? 0), 0))
          ? samples.reduce((total, sample) => total + sample.errors!, 0)
          : null;
      return {
        timestamp: point.timestamp,
        requests,
        errors,
        errorPercent:
          requests !== null && errors !== null && requests > 0 ? (errors / requests) * 100 : null,
      };
    });
    result.status = 'ready';
    return result;
  });
}
