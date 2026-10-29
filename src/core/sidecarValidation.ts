import { decodeLabelSelector } from './labels';
import { validationMeshRoot } from './mesh';
import { isDnsLabel, isRecord } from './object';
import type { ReferenceValidationContext } from './referenceValidation';
import type { Finding } from './validation';

export function sidecarNeedsMeshConfiguration(kind: string, group: string, spec: unknown): boolean {
  if (
    kind !== 'Sidecar' ||
    group !== 'networking.istio.io' ||
    !isRecord(spec) ||
    !isRecord(spec.workloadSelector) ||
    !isRecord(spec.workloadSelector.labels)
  )
    return false;
  const count = Object.keys(spec.workloadSelector.labels).length;
  return count > 0 && count <= 100;
}

export function sidecarRootSelectorChecks(
  kind: string,
  group: string,
  namespace: string,
  spec: Record<string, unknown>,
  context?: ReferenceValidationContext
): { findings: Finding[]; skipped: string[] } {
  const findings: Finding[] = [];
  const skipped: string[] = [];
  if (kind !== 'Sidecar' || group !== 'networking.istio.io') return { findings, skipped };
  try {
    const selector = spec.workloadSelector;
    if (selector === undefined || selector === null) return { findings, skipped };
    if (!isRecord(selector) || Object.keys(selector).some(key => key !== 'labels'))
      throw new Error('Sidecar workload selector is malformed or has unsupported fields');
    const labels = decodeLabelSelector({ matchLabels: selector.labels }).matchLabels;
    if (!labels || !Object.keys(labels).length) return { findings, skipped };
    if (!isDnsLabel(namespace) || namespace.trim() !== namespace)
      throw new Error('Sidecar root-selector check requires an explicit valid namespace');
    const mesh = context?.namespaceMesh?.get(namespace);
    if (mesh?.status !== 'ready')
      throw new Error(
        `Sidecar root-selector check requires resolved namespace mesh configuration${
          mesh?.status === 'unavailable' ? `: ${mesh.message}` : ''
        }`
      );
    const root = validationMeshRoot(mesh);
    if (namespace === root)
      findings.push({
        code: 'KIA1006',
        severity: 'warning',
        path: 'spec/workloadSelector',
        message: 'Global default sidecar should not have workloadSelector',
      });
  } catch (error) {
    skipped.push(
      error instanceof Error ? error.message : 'Unable to evaluate the Sidecar root selector'
    );
  }
  return { findings, skipped };
}
