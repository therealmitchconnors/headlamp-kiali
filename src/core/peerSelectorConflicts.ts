import { isRecord } from './object';
import type {
  ReferenceValidationContext,
  ValidationOwner,
  ValidationRecord,
} from './referenceValidation';
import type { Finding, FindingReference } from './validation';
import { namespacedValidationRecords } from './validationScope';

function selector(spec: Record<string, unknown>): [string, string][] {
  const raw = spec.selector;
  if (raw === undefined || raw === null) return [];
  if (!isRecord(raw) || Object.keys(raw).some(key => key !== 'matchLabels'))
    throw new Error('PeerAuthentication selector is unavailable or unsupported');
  const labels = raw.matchLabels ?? {};
  if (!isRecord(labels) || Object.keys(labels).length > 256)
    throw new Error('PeerAuthentication conflicts require at most 256 selector labels per object');
  return Object.entries(labels)
    .map(([key, value]): [string, string] => {
      if (typeof value !== 'string' || key.length > 1024 || value.length > 1024)
        throw new Error('PeerAuthentication selector labels must be bounded strings');
      return [key, value];
    })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

export function peerSelectorlessNeedsContext(kind: string, group: string, spec: unknown): boolean {
  if (kind !== 'PeerAuthentication' || group !== 'security.istio.io' || !isRecord(spec))
    return false;
  // Invalid selectors are reported by the checker without scheduling unrelated reads.
  const raw = spec.selector;
  return (
    raw === undefined ||
    raw === null ||
    (isRecord(raw) &&
      Object.keys(raw).every(key => key === 'matchLabels') &&
      (raw.matchLabels === undefined ||
        raw.matchLabels === null ||
        (isRecord(raw.matchLabels) && !Object.keys(raw.matchLabels).length)))
  );
}

export function peerSelectorlessReferences(
  records: readonly Pick<ValidationRecord, 'name' | 'namespace' | 'spec'>[],
  selectedIndex: number
): number[] {
  if (
    records.length > 1000 ||
    !Number.isInteger(selectedIndex) ||
    selectedIndex < 0 ||
    selectedIndex >= records.length
  )
    throw new Error('PeerAuthentication conflicts require bounded records and a selected identity');
  if (selector(records[selectedIndex].spec).length) return [];
  const namespace = records[selectedIndex].namespace;
  const references: number[] = [];
  let labelCount = 0;
  let textSize = 0;
  records.forEach((record, index) => {
    if (index === selectedIndex || record.namespace !== namespace) return;
    const labels = selector(record.spec);
    labelCount += labels.length;
    textSize += labels.reduce((sum, [key, value]) => sum + key.length + value.length, 0);
    if (labelCount > 10000 || textSize > 1000000)
      throw new Error(
        'PeerAuthentication conflicts exceed 10000 labels or 1000000 label-text characters'
      );
    if (!labels.length) references.push(index);
  });
  return references;
}

export function peerSelectorlessChecks(
  kind: string,
  group: string,
  namespace: string,
  spec: Record<string, unknown>,
  context?: ReferenceValidationContext,
  owner?: ValidationOwner
): { findings: Finding[]; skipped: string[] } {
  if (kind !== 'PeerAuthentication' || group !== 'security.istio.io')
    return { findings: [], skipped: [] };
  try {
    const target = selector(spec);
    if (target.length) return { findings: [], skipped: [] };
    if (!owner || !context?.peerAuthentications?.complete)
      throw new Error(
        'Selectorless PeerAuthentication checks require captured identity and a complete policy list'
      );
    const records = namespacedValidationRecords(context.peerAuthentications.items);
    const index = records.findIndex(
      record => record.name === owner.name && record.namespace === namespace
    );
    if (
      index < 0 ||
      records[index].uid !== owner.uid ||
      JSON.stringify(selector(records[index].spec)) !== JSON.stringify(target)
    )
      throw new Error(
        'PeerAuthentication identity or selector changed; reload before checking conflicts'
      );
    const mesh = context.namespaceMesh?.get(namespace);
    if (mesh?.status !== 'ready')
      throw new Error(
        mesh?.status === 'unavailable'
          ? mesh.message
          : 'Selectorless PeerAuthentication checks require resolved namespace mesh configuration'
      );
    const references = peerSelectorlessReferences(records, index)
      .map(
        (index): FindingReference => ({
          kind: 'PeerAuthentication',
          group: 'security.istio.io',
          name: records[index].name,
          namespace: records[index].namespace,
          uid: records[index].uid,
        })
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      skipped: [],
      findings: references.length
        ? [
            {
              code: 'KIA0002',
              severity: 'error',
              path: 'spec/selector',
              message: 'More than one selector-less object in the same namespace',
              references,
            },
          ]
        : [],
    };
  } catch (error) {
    return {
      findings: [],
      skipped: [
        error instanceof Error
          ? error.message
          : 'Unable to evaluate selectorless PeerAuthentication conflicts',
      ],
    };
  }
}
