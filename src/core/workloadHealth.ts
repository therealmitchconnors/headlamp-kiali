import { DirectionalRates, WorkloadStatus } from './health';
import { HealthReporterMode, healthRequestQuery, requestHealthCode } from './healthReporters';
import { isDnsLabel, isDnsSubdomain, isRecord } from './object';
import { MetricResult, validateTelemetryScope } from './telemetry';

export const healthWorkloadKinds = [
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'ReplicaSet',
  'ReplicationController',
] as const;
export type HealthWorkloadKind = (typeof healthWorkloadKinds)[number];
export interface WorkloadHealthQuery {
  kind: HealthWorkloadKind;
  namespace: string;
  name: string;
  telemetryCluster: string;
  end: number;
  reporterMode?: HealthReporterMode;
}

export function isHealthWorkloadKind(value: string): value is HealthWorkloadKind {
  return healthWorkloadKinds.some(kind => kind === value);
}

export function healthWorkloadPath(query: WorkloadHealthQuery): string {
  if (
    !isHealthWorkloadKind(query.kind) ||
    !isDnsLabel(query.namespace) ||
    !isDnsSubdomain(query.name)
  )
    throw new Error('Select a supported workload kind, namespace and name');
  const resources: Record<HealthWorkloadKind, string> = {
    Deployment: 'deployments',
    StatefulSet: 'statefulsets',
    DaemonSet: 'daemonsets',
    ReplicaSet: 'replicasets',
    ReplicationController: 'replicationcontrollers',
  };
  const prefix = query.kind === 'ReplicationController' ? '/api/v1' : '/apis/apps/v1';
  return `${prefix}/namespaces/${query.namespace}/${resources[query.kind]}/${query.name}`;
}

export function workloadHealthQueries(query: WorkloadHealthQuery) {
  healthWorkloadPath(query);
  validateTelemetryScope(query);
  const scope = { ...query, target: 'workload' as const };
  return {
    inbound: healthRequestQuery({ ...scope, direction: 'inbound' }),
    outbound: healthRequestQuery({ ...scope, direction: 'outbound' }),
  };
}

export interface WorkloadHealthResource {
  replicas: WorkloadStatus | null;
  annotations: Record<string, string>;
  stale: boolean;
}

export function workloadHealthResource(
  value: unknown,
  query: Pick<WorkloadHealthQuery, 'kind' | 'namespace' | 'name'>
): WorkloadHealthResource {
  const apiVersion = query.kind === 'ReplicationController' ? 'v1' : 'apps/v1';
  if (
    !isRecord(value) ||
    value.kind !== query.kind ||
    value.apiVersion !== apiVersion ||
    !isRecord(value.metadata) ||
    value.metadata.name !== query.name ||
    value.metadata.namespace !== query.namespace ||
    !isRecord(value.spec)
  )
    throw new Error('Workload response does not match the requested resource');
  const template =
    isRecord(value.spec.template) && isRecord(value.spec.template.metadata)
      ? value.spec.template.metadata
      : undefined;
  // Kiali uses template health annotations except for DaemonSets, which override with the controller.
  const annotations =
    query.kind === 'DaemonSet'
      ? value.metadata.annotations
      : template?.annotations ?? value.metadata.annotations;
  if (
    annotations !== undefined &&
    (!isRecord(annotations) || Object.values(annotations).some(item => typeof item !== 'string'))
  )
    throw new Error('Workload health annotations are malformed');
  const annotationEntries = Object.entries(annotations ?? {}).map(([key, value]) => [
    key,
    String(value),
  ]);
  const status = isRecord(value.status) ? value.status : undefined;
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2147483647;
  const desired = query.kind === 'DaemonSet' ? status?.desiredNumberScheduled : value.spec.replicas;
  const current =
    query.kind === 'DaemonSet' ? status?.currentNumberScheduled ?? 0 : status?.replicas ?? 0;
  const available =
    query.kind === 'DaemonSet'
      ? status?.numberAvailable ?? 0
      : query.kind === 'StatefulSet'
      ? status?.readyReplicas ?? 0
      : status?.availableReplicas ?? 0;
  const replicas =
    status && count(desired) && count(current) && count(available)
      ? {
          desiredReplicas: Number(desired),
          currentReplicas: Number(current),
          availableReplicas: Number(available),
          syncedProxies: -1,
        }
      : null;
  const generation = value.metadata.generation;
  const observed = status?.observedGeneration;
  return {
    replicas,
    annotations: Object.fromEntries(annotationEntries),
    stale:
      typeof generation === 'number' && (typeof observed !== 'number' || observed < generation),
  };
}

export function healthRequestRates(result: MetricResult): DirectionalRates {
  const protocols = new Map<string, Map<string, number>>();
  for (const series of result.series) {
    const protocol = series.labels.request_protocol;
    const code = requestHealthCode(series.labels);
    const rate = series.samples[0]?.value;
    if (
      !protocol ||
      code === undefined ||
      code === '' ||
      series.samples.length !== 1 ||
      rate === null ||
      rate === undefined ||
      rate < 0 ||
      !Number.isFinite(rate)
    )
      throw new Error(
        'Request health requires protocol, response code and a finite nonnegative instant rate'
      );
    let codes = protocols.get(protocol);
    if (!codes) {
      codes = new Map();
      protocols.set(protocol, codes);
    }
    const sum = (codes.get(code) ?? 0) + rate;
    if (!Number.isFinite(sum)) throw new Error('Request health rates exceeded numeric limits');
    codes.set(code, sum);
  }
  return Object.fromEntries(
    [...protocols].map(([protocol, codes]) => [protocol, Object.fromEntries(codes)])
  );
}
