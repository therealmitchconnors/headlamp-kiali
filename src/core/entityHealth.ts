import { Application } from './correlation';
import { WorkloadStatus } from './health';
import { HealthReporterMode, healthRequestQuery } from './healthReporters';
import { isDnsLabel, isRecord } from './object';
import { validateTelemetryScope } from './telemetry';

interface EntityHealthScope {
  namespace: string;
  name: string;
  telemetryCluster: string;
  end: number;
  reporterMode?: HealthReporterMode;
}
export type EntityHealthQuery =
  | (EntityHealthScope & { kind: 'Application'; telemetryApp: string })
  | (EntityHealthScope & { kind: 'Service' });

export function entityHealthQueries(query: EntityHealthQuery): {
  inbound: string;
  outbound?: string;
} {
  validateTelemetryScope(query);
  if (query.kind === 'Service' ? !isDnsLabel(query.name) : query.name.length > 256)
    throw new Error('Invalid health subject name');
  if (
    query.kind === 'Application' &&
    (!query.telemetryApp.trim() || query.telemetryApp.length > 256)
  )
    throw new Error('An explicit nonempty Istio canonical service label is required');
  const scope = {
    ...query,
    name: query.kind === 'Application' ? query.telemetryApp : query.name,
    target: query.kind === 'Application' ? ('canonical_service' as const) : ('service' as const),
  };
  return {
    inbound: healthRequestQuery({ ...scope, direction: 'inbound' }),
    ...(query.kind === 'Application'
      ? { outbound: healthRequestQuery({ ...scope, direction: 'outbound' }) }
      : {}),
  };
}

export function serviceHealthResource(
  value: unknown,
  query: Pick<EntityHealthQuery, 'name' | 'namespace'>
): { annotations: Record<string, string> } {
  if (
    !isRecord(value) ||
    value.kind !== 'Service' ||
    value.apiVersion !== 'v1' ||
    !isRecord(value.metadata) ||
    value.metadata.name !== query.name ||
    value.metadata.namespace !== query.namespace ||
    !isRecord(value.spec)
  )
    throw new Error('Service response does not match the requested health subject');
  const annotations = value.metadata.annotations ?? {};
  if (!isRecord(annotations) || Object.values(annotations).some(value => typeof value !== 'string'))
    throw new Error('Invalid Service health annotations');
  return {
    annotations: Object.fromEntries(
      Object.entries(annotations).map(([key, value]) => [key, String(value)])
    ),
  };
}

export function applicationReplicaEvidence(app: Application): {
  statuses: WorkloadStatus[];
  issues: string[];
} {
  const statuses: WorkloadStatus[] = [];
  const issues: string[] = [];
  if (!app.workloads.length) issues.push('No application workloads were resolved');
  if (app.workloads.length > 100)
    return { statuses, issues: ['Application health exceeds the 100-workload limit'] };
  for (const workload of app.workloads) {
    const identity = `${workload.identity.kind}/${workload.identity.name}`;
    const health = workload.resource.health;
    if (!health) issues.push(`${identity}: replica health is not supported or was not collected`);
    else if (health.ok === false) issues.push(`${identity}: ${health.message}`);
    else if (health.value.stale) issues.push(`${identity}: controller generation is stale`);
    else if (!health.value.replicas) issues.push(`${identity}: replica counts are incomplete`);
    else statuses.push(health.value.replicas);
  }
  return { statuses, issues };
}
