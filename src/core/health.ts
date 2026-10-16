/*
 * Adapted from Kiali v2.33.0 models/health_status.go (Apache-2.0).
 * See test-files/README.md for source identity and differential verification.
 */

export type HealthStatus = 'Healthy' | 'Degraded' | 'Failure' | 'Not Ready' | 'NA';

export interface WorkloadStatus {
  desiredReplicas: number;
  currentReplicas: number;
  availableReplicas: number;
  syncedProxies: number;
}

export type DirectionalRates = Readonly<Record<string, Readonly<Record<string, number>>>>;

export interface RequestHealth {
  inbound?: DirectionalRates | null;
  outbound?: DirectionalRates | null;
}

export function healthStatusPriority(status: string): number {
  switch (status) {
    case 'Failure':
      return 4;
    case 'Degraded':
      return 3;
    case 'Not Ready':
      return 2;
    case 'Healthy':
      return 1;
    default:
      return 0;
  }
}

export function mergeHealthStatus<T extends string>(first: T, second: T): T {
  return healthStatusPriority(first) > healthStatusPriority(second) ? first : second;
}

export function workloadStatusHealth(workload: WorkloadStatus | null): HealthStatus {
  if (!workload) {
    return 'NA';
  }
  const {
    desiredReplicas: desired,
    currentReplicas: current,
    availableReplicas: available,
    syncedProxies: synced,
  } = workload;
  if (desired === 0) {
    return 'Not Ready';
  }
  if (desired > 0 && current > 0 && available > 0 && (current < desired || available < desired)) {
    return 'Degraded';
  }
  if (desired > 0 && available === 0) {
    return 'Failure';
  }
  if (desired === available && available !== current) {
    return 'Failure';
  }
  if (synced >= 0 && synced < desired) {
    return 'Degraded';
  }
  return desired === current && current === available ? 'Healthy' : 'Degraded';
}

export function directionalRequestRate(direction?: DirectionalRates | null): number {
  let total = 0;
  for (const codes of Object.values(direction ?? {})) {
    for (const count of Object.values(codes)) {
      total += count;
    }
  }
  return total;
}

export function totalRequestRate(requests: RequestHealth): number {
  return directionalRequestRate(requests.inbound) + directionalRequestRate(requests.outbound);
}

/** Kiali's simple fallback only; protocol-aware health uses separate tolerances. */
export function simpleRequestErrorRatio(requests: RequestHealth): number {
  let total = 0;
  let errors = 0;
  for (const direction of [requests.inbound, requests.outbound]) {
    for (const codes of Object.values(direction ?? {})) {
      for (const [code, count] of Object.entries(codes)) {
        total += count;
        if (code.startsWith('4') || code.startsWith('5')) {
          errors += count;
        }
      }
    }
  }
  return total === 0 ? -1 : errors / total;
}
