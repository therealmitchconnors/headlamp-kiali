import { isRecord } from './object';

export interface ReplicaReadiness {
  ready: number;
  desired: number;
}

function replicas(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function replicaReadiness(resource: unknown): ReplicaReadiness | null {
  if (!isRecord(resource) || !isRecord(resource.spec) || !isRecord(resource.status)) {
    return null;
  }
  let desired: unknown;
  let ready: unknown;
  switch (resource.kind) {
    case 'Deployment':
    case 'StatefulSet':
    case 'ReplicaSet':
    case 'ReplicationController':
      desired = resource.spec.replicas ?? 1;
      ready = resource.status.readyReplicas ?? 0;
      break;
    case 'DaemonSet':
      desired = resource.status.desiredNumberScheduled;
      ready = resource.status.numberReady ?? 0;
      break;
    default:
      return null;
  }
  return replicas(desired) && replicas(ready) ? { desired, ready } : null;
}
