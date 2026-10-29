import { isRecord } from './object';

export const WORKLOAD_ENTRY_HEALTH_ANNOTATION = 'proxy.istio.io/health-checks-enabled';

export interface WorkloadEntryHealthEvidence {
  basis:
    | 'condition'
    | 'missing-condition'
    | 'unknown-condition'
    | 'disabled-checks'
    | 'invalid-annotation';
  kialiAvailable: boolean;
  annotation?: string;
  condition?: {
    status: string;
    reason?: string;
    message?: string;
    lastProbeTime?: string;
    lastTransitionTime?: string;
  };
}
export type WorkloadEntryHealthRead =
  | { ok: true; evidence: WorkloadEntryHealthEvidence }
  | { ok: false; message: string };

export function workloadEntryHealthEvidence(
  annotations: unknown,
  status: unknown
): WorkloadEntryHealthEvidence {
  if (annotations !== undefined && annotations !== null && !isRecord(annotations))
    throw new Error('WorkloadEntry annotations are malformed');
  const raw = isRecord(annotations) ? annotations[WORKLOAD_ENTRY_HEALTH_ANNOTATION] : undefined;
  if (raw !== undefined && (typeof raw !== 'string' || raw.length > 1024))
    throw new Error('WorkloadEntry health annotation must be a string of at most 1024 characters');
  const annotation = typeof raw === 'string' ? raw : undefined;
  const enabled = ['1', 't', 'T', 'true', 'TRUE', 'True'].includes(annotation ?? '');
  if (!enabled) {
    const disabled =
      annotation === undefined ||
      ['', '0', 'f', 'F', 'false', 'FALSE', 'False'].includes(annotation);
    return {
      basis: disabled ? 'disabled-checks' : 'invalid-annotation',
      kialiAvailable: true,
      annotation,
    };
  }
  if (status !== undefined && status !== null && !isRecord(status))
    throw new Error('WorkloadEntry status is malformed');
  const conditions = isRecord(status) ? status.conditions ?? [] : [];
  if (!Array.isArray(conditions) || conditions.length > 100)
    throw new Error('WorkloadEntry probe evidence requires at most 100 conditions');
  let characters = 0;
  for (const condition of conditions) {
    if (!isRecord(condition)) throw new Error('WorkloadEntry condition is malformed');
    const type = condition.type ?? '';
    const value = condition.status ?? '';
    if (
      typeof type !== 'string' ||
      typeof value !== 'string' ||
      type.length > 256 ||
      value.length > 256
    )
      throw new Error('WorkloadEntry condition type/status must be bounded strings');
    if ((characters += type.length + value.length) > 20000)
      throw new Error('WorkloadEntry probe evidence exceeds 20000 condition characters');
    if (type !== 'Healthy') continue;
    const text = (field: string, maximum: number): string | undefined => {
      const value = condition[field];
      if (value === undefined || value === null) return undefined;
      if (typeof value !== 'string' || value.length > maximum)
        throw new Error(`WorkloadEntry condition ${field} is malformed or oversized`);
      return value;
    };
    return {
      basis: value === 'True' || value === 'False' ? 'condition' : 'unknown-condition',
      kialiAvailable: value === 'True',
      annotation,
      condition: {
        status: value,
        reason: text('reason', 1024),
        message: text('message', 4096),
        lastProbeTime: text('lastProbeTime', 128),
        lastTransitionTime: text('lastTransitionTime', 128),
      },
    };
  }
  return { basis: 'missing-condition', kialiAvailable: false, annotation };
}

export function readWorkloadEntryHealth(
  annotations: unknown,
  status: unknown
): WorkloadEntryHealthRead {
  try {
    return { ok: true, evidence: workloadEntryHealthEvidence(annotations, status) };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : 'WorkloadEntry probe evidence is unavailable',
    };
  }
}
