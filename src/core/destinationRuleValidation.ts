import { getHost, hostString, hostWithinWildcardHost, parseHost } from './hosts';
import { importsHost } from './importScope';
import { ClientTlsMode, clientTlsMode } from './mtls';
import { isDnsLabel, isDnsSubdomain, isRecord } from './object';
import type {
  ReferenceValidationContext,
  ValidationOwner,
  ValidationRecord,
} from './referenceValidation';
import type { Finding } from './validation';
import {
  configurationExportIncluded,
  configurationExports,
  configurationImportScope,
  namespacedValidationRecords,
} from './validationScope';

interface DestinationFields {
  host: string;
  subsets: string[];
  mode?: ClientTlsMode;
  hasTls: boolean;
  portSettings: number;
  exportTo: string[];
}
function fields(spec: Record<string, unknown>): DestinationFields {
  if (typeof spec.host !== 'string' || !spec.host || spec.host.length > 1024)
    throw new Error('DestinationRule conflicts require a nonempty host of at most 1024 characters');
  const subsets = spec.subsets ?? [];
  if (!Array.isArray(subsets) || subsets.length > 100)
    throw new Error('DestinationRule conflicts require at most 100 subsets per rule');
  const names = subsets.map(subset => {
    if (!isRecord(subset) || typeof subset.name !== 'string' || subset.name.length > 256)
      throw new Error('DestinationRule subset names are unavailable or malformed');
    return subset.name;
  });
  let mode: ClientTlsMode | undefined;
  let hasTls = false;
  let portSettings = 0;
  if (spec.trafficPolicy !== undefined && spec.trafficPolicy !== null) {
    if (!isRecord(spec.trafficPolicy))
      throw new Error('DestinationRule traffic policy is malformed');
    const tls = spec.trafficPolicy.tls;
    if (tls !== undefined && tls !== null) {
      mode = clientTlsMode(tls);
      hasTls = true;
    }
    const ports = spec.trafficPolicy.portLevelSettings ?? [];
    if (!Array.isArray(ports) || ports.length > 100)
      throw new Error('DestinationRule TLS checks require at most 100 port-level settings');
    portSettings = ports.length;
    for (const port of ports) {
      if (!isRecord(port)) throw new Error('DestinationRule port-level settings are malformed');
      if (port.tls !== undefined && port.tls !== null) {
        if (!isRecord(port.tls)) throw new Error('DestinationRule port-level TLS is malformed');
        hasTls = true;
      }
    }
  }
  return {
    host: spec.host,
    subsets: names.length ? names : ['~'],
    mode,
    hasTls,
    portSettings,
    exportTo: configurationExports(spec),
  };
}
export function destinationHostsOverlap(a: string, b: string): boolean {
  return (
    a === b ||
    a === '*' ||
    b === '*' ||
    hostWithinWildcardHost(b, a) ||
    hostWithinWildcardHost(a, b)
  );
}
export function destinationDefaultMtls(
  namespace: string,
  host: string,
  mode: string | undefined,
  domain: string
): boolean {
  return mode === 'ISTIO_MUTUAL' && (host === '*.local' || host === `*.${namespace}.${domain}`);
}

export function destinationRuleConflictPairs(
  records: readonly Pick<ValidationRecord, 'name' | 'namespace' | 'spec'>[],
  namespaces: readonly string[],
  domain: string,
  selectedIndex?: number
): [number, number][] {
  if (
    records.length > 1000 ||
    namespaces.length > 1000 ||
    !isDnsSubdomain(domain) ||
    domain.trim() !== domain
  )
    throw new Error(
      'DestinationRule conflicts require bounded records/namespaces and an explicit DNS identity domain'
    );
  if (
    selectedIndex !== undefined &&
    (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= records.length)
  )
    throw new Error('Invalid selected DestinationRule index');
  let subsetCount = 0;
  const parsed = records.map(record => {
    const parsed = fields(record.spec);
    subsetCount += parsed.subsets.length + parsed.portSettings;
    if (subsetCount > 10000)
      throw new Error('DestinationRule checks exceed 10000 subsets and port settings');
    return {
      ...parsed,
      key: hostString(getHost(parsed.host, record.namespace, namespaces, domain)),
      ignored: destinationDefaultMtls(record.namespace, parsed.host, parsed.mode, domain),
    };
  });
  const pairs: [number, number][] = [];
  let comparisons = 0;
  for (let later = 0; later < parsed.length; later++) {
    if (parsed[later].ignored) continue;
    const start = selectedIndex !== undefined && later !== selectedIndex ? selectedIndex : 0;
    const end =
      selectedIndex !== undefined && later !== selectedIndex
        ? Math.min(later, selectedIndex + 1)
        : later;
    for (let earlier = start; earlier < end; earlier++) {
      if (++comparisons > 20000)
        throw new Error('DestinationRule conflicts exceed 20000 rule comparisons');
      const current = parsed[later];
      const previous = parsed[earlier];
      if (previous.ignored || !destinationHostsOverlap(current.key, previous.key)) continue;
      const old = new Set(previous.subsets);
      if (
        (current.subsets.length === 1 && current.subsets[0] === '~') ||
        old.has('~') ||
        current.subsets.some(subset => old.has(subset))
      )
        pairs.push([earlier, later]);
    }
  }
  return pairs;
}

export function destinationRuleTlsOverrides(
  records: readonly Pick<ValidationRecord, 'name' | 'namespace' | 'spec'>[],
  domain: string,
  selectedIndex: number
): number[] {
  if (
    records.length > 1000 ||
    !isDnsSubdomain(domain) ||
    domain.trim() !== domain ||
    !Number.isInteger(selectedIndex) ||
    selectedIndex < 0 ||
    selectedIndex >= records.length
  )
    throw new Error(
      'DestinationRule TLS checks require bounded records, a selected rule and explicit DNS identity'
    );
  let count = 0;
  const parsed = records.map(record => {
    const value = fields(record.spec);
    count += value.subsets.length + value.portSettings;
    if (count > 10000)
      throw new Error('DestinationRule checks exceed 10000 subsets and port settings');
    return value;
  });
  const selected = parsed[selectedIndex];
  if (selected.hasTls) return [];
  const namespace = records[selectedIndex].namespace;
  const host = parseHost(selected.host, namespace, domain);
  const references = new Set<number>();
  parsed.forEach((value, index) => {
    if (destinationDefaultMtls(records[index].namespace, value.host, value.mode, domain)) {
      const peer = parseHost(value.host, namespace, domain);
      if (
        peer.service === '*.local' ||
        (peer.identityDomain === host.identityDomain && peer.namespace === host.namespace)
      )
        references.add(index);
    }
    if (
      index !== selectedIndex &&
      value.mode === 'ISTIO_MUTUAL' &&
      (value.host === `*.${host.namespace}.${host.identityDomain}` ||
        value.host === hostString(host))
    )
      references.add(index);
  });
  return [...references].sort((a, b) => a - b);
}

export function destinationRuleChecks(
  kind: string,
  group: string,
  namespace: string,
  spec: Record<string, unknown>,
  context?: ReferenceValidationContext,
  owner?: ValidationOwner
): { findings: Finding[]; skipped: string[] } {
  if (kind !== 'DestinationRule' || group !== 'networking.istio.io')
    return { findings: [], skipped: [] };
  try {
    const target = fields(spec);
    const domain = context?.identityDomain;
    if (!context || !domain || !isDnsSubdomain(domain) || domain.trim() !== domain)
      throw new Error(
        'DestinationRule conflict checks require an explicit Service DNS identity domain'
      );
    if (destinationDefaultMtls(namespace, target.host, target.mode, domain))
      return { findings: [], skipped: [] };
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
      throw new Error(
        'DestinationRule conflict checks require the captured namespace, name and UID'
      );
    if (
      !context.namespaces.complete ||
      !context.destinationRules.complete ||
      !context.sidecars.complete ||
      [context.namespaces.items, context.destinationRules.items, context.sidecars.items].some(
        items => items.length > 1000
      )
    )
      throw new Error(
        'DestinationRule conflict checks require complete bounded Namespace, DestinationRule and Sidecar lists'
      );
    const records = namespacedValidationRecords(context.destinationRules.items);
    const selected = records.find(
      record => record.name === owner.name && record.namespace === namespace
    );
    if (
      !selected ||
      selected.uid !== owner.uid ||
      JSON.stringify(fields(selected.spec)) !== JSON.stringify(target)
    )
      throw new Error(
        'DestinationRule identity or relevant specification changed; reload before checking conflicts'
      );
    const namespaces = context.namespaces.items.map(item => item.name);
    if (!namespaces.includes(namespace))
      throw new Error('Selected namespace is missing from DestinationRule context');
    const scope = configurationImportScope(namespace, context);
    const visible = records.filter(
      record =>
        configurationExportIncluded('DestinationRule', record, namespace, context) &&
        typeof record.spec.host === 'string' &&
        importsHost(scope, record.spec.host, record.namespace)
    );
    const index = visible.indexOf(selected);
    if (index < 0)
      return {
        findings: [],
        skipped: [
          'Selected DestinationRule is not exported and imported into this namespace validation scope',
        ],
      };
    const pairs = destinationRuleConflictPairs(visible, namespaces, domain, index);
    const peers = new Set(pairs.map(([a, b]) => (a === index ? b : a)));
    const references = (indices: readonly number[]): NonNullable<Finding['references']> =>
      indices
        .map((index): NonNullable<Finding['references']>[number] => ({
          kind: 'DestinationRule',
          group: 'networking.istio.io',
          name: visible[index].name,
          namespace: visible[index].namespace,
          uid: visible[index].uid,
        }))
        .sort((a, b) =>
          JSON.stringify([a.namespace, a.name]).localeCompare(JSON.stringify([b.namespace, b.name]))
        );
    const findings: Finding[] = [];
    if (peers.size)
      findings.push({
        code: 'KIA0201',
        severity: 'warning',
        path: 'spec/host',
        message: 'More than one DestinationRules for the same host subset combination',
        references: references([...peers]),
      });
    const tls = destinationRuleTlsOverrides(visible, domain, index);
    if (tls.length)
      findings.push({
        code: 'KIA0204',
        severity: 'warning',
        path: 'spec/trafficPolicy',
        message: 'mTLS settings of a non-local Destination Rule are overridden',
        references: references(tls),
      });
    return { skipped: [], findings };
  } catch (error) {
    return {
      findings: [],
      skipped: [
        error instanceof Error ? error.message : 'Unable to evaluate DestinationRule conflicts',
      ],
    };
  }
}
