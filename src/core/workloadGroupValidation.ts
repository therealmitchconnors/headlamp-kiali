import { isDnsLabel, isDnsSubdomain, isRecord } from './object';
import type { ReferenceValidationContext, ValidationOwner } from './referenceValidation';
import type { Finding } from './validation';

function labels(spec: Record<string, unknown>): string | null {
  if (spec.metadata === undefined || spec.metadata === null) return null;
  if (!isRecord(spec.metadata)) throw new Error('WorkloadGroup metadata is malformed');
  const values = spec.metadata.labels ?? {};
  if (!isRecord(values)) throw new Error('WorkloadGroup labels are malformed');
  const entries = Object.entries(values);
  if (
    entries.length > 100 ||
    entries.some(
      ([key, value]) => key.length > 1024 || typeof value !== 'string' || value.length > 4096
    )
  )
    throw new Error('WorkloadGroup labels are invalid or exceed the bounded label size');
  return JSON.stringify(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function workloadGroupChecks(
  kind: string,
  group: string,
  namespace: string,
  spec: Record<string, unknown>,
  context?: ReferenceValidationContext,
  owner?: ValidationOwner
): { findings: Finding[]; skipped: string[] } {
  const findings: Finding[] = [];
  const skipped: string[] = [];
  if (kind !== 'WorkloadGroup' || group !== 'networking.istio.io') return { findings, skipped };
  try {
    const target = labels(spec);
    if (target === null) return { findings, skipped };
    if (
      !isDnsLabel(namespace) ||
      namespace.trim() !== namespace ||
      !owner ||
      !isDnsSubdomain(owner.name) ||
      owner.name.trim() !== owner.name ||
      typeof owner.uid !== 'string' ||
      !owner.uid ||
      owner.uid.trim() !== owner.uid
    )
      throw new Error('WorkloadGroup label checks require the captured namespace, name and UID');
    const source = context?.workloadGroups;
    if (!source?.complete || source.namespace !== namespace || source.items.length > 1000)
      throw new Error(
        'WorkloadGroup label checks require a complete bounded list from the same namespace'
      );
    if (
      source.items.some(
        item =>
          item.namespace !== namespace ||
          !isDnsSubdomain(item.name) ||
          item.name.trim() !== item.name ||
          typeof item.uid !== 'string' ||
          !item.uid ||
          item.uid.trim() !== item.uid
      )
    )
      throw new Error('WorkloadGroup context has invalid identity or namespace provenance');
    const current = source.items.filter(item => item.name === owner.name);
    if (current.length !== 1 || current[0].uid !== owner.uid || labels(current[0].spec) !== target)
      throw new Error(
        'WorkloadGroup identity or labels changed; reload before checking label conflicts'
      );
    const peers = source.items
      .filter(item => item.name !== owner.name)
      .map(item => labels(item.spec));
    if (peers.some(peer => peer !== null && peer === target))
      findings.push({
        code: 'KIA1702',
        severity: 'warning',
        path: 'spec/metadata/labels',
        message: 'More than one Workload Group with duplicate labels found in the same namespace',
      });
  } catch (error) {
    skipped.push(
      error instanceof Error ? error.message : 'Unable to evaluate WorkloadGroup labels'
    );
  }
  return { findings, skipped };
}
