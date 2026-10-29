import { RE2JS } from 're2js';
import { isRecord } from './object';
import type {
  ReferenceValidationContext,
  ValidationOwner,
  ValidationRecord,
} from './referenceValidation';
import type { Finding, FindingReference } from './validation';
import { namespacedValidationRecords } from './validationScope';

function fields(spec: Record<string, unknown>) {
  const selector = spec.selector ?? {};
  if (!isRecord(selector) || Object.keys(selector).length > 256)
    throw new Error('Istio Gateway conflicts require a bounded selector map');
  const labels = Object.entries(selector).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (
    labels.some(
      ([key, value]) =>
        typeof value !== 'string' ||
        key.length > 1024 ||
        value.length > 1024 ||
        /[^\x20-\x7e]/.test(key) ||
        /[^\x20-\x7e]/.test(value)
    )
  )
    throw new Error('Istio Gateway selector keys and values must be bounded ASCII strings');
  const raw = spec.servers ?? [];
  if (!Array.isArray(raw) || raw.length > 100)
    throw new Error('Istio Gateway conflicts require at most 100 servers per object');
  let count = 0;
  const servers = raw.map(server => {
    if (server === null) return null;
    if (!isRecord(server)) throw new Error('Malformed Istio Gateway server');
    const hosts = server.hosts ?? [];
    if (
      !Array.isArray(hosts) ||
      hosts.length > 100 ||
      hosts.some(
        host => typeof host !== 'string' || host.length > 1024 || /[^\x20-\x7e]/.test(host)
      )
    )
      throw new Error('Istio Gateway conflicts require at most 100 bounded ASCII hosts per server');
    if ((count += hosts.length) > 2000) throw new Error('Istio Gateway context exceeds 2000 hosts');
    let port = 0;
    if (server.port !== undefined && server.port !== null) {
      if (!isRecord(server.port)) throw new Error('Malformed Istio Gateway port');
      const number = server.port.number ?? 0;
      if (
        typeof number !== 'number' ||
        !Number.isInteger(number) ||
        number < 0 ||
        number > 4294967295
      )
        throw new Error('Istio Gateway port number is not a uint32');
      port = number;
    }
    return { hosts: hosts.map(host => String(host)), port };
  });
  return { selector: labels.map(([key, value]) => `${key}=${value}`).join(','), servers };
}

export function istioGatewayNeedsConflicts(
  kind: string,
  group: string,
  spec: Record<string, unknown>
) {
  return (
    kind === 'Gateway' &&
    group === 'networking.istio.io' &&
    Array.isArray(spec.servers) &&
    spec.servers.some(
      server => isRecord(server) && Array.isArray(server.hosts) && server.hosts.length > 0
    )
  );
}

interface Host {
  record: number;
  server: number;
  index: number;
  name: string;
  namespace: string;
}

export function istioGatewayHostConflicts(
  records: readonly Pick<ValidationRecord, 'name' | 'namespace' | 'spec'>[],
  selectedIndex: number,
  skipWildcardGatewayHosts = false
): { paths: string[]; references: number[] } {
  if (
    records.length > 1000 ||
    !Number.isInteger(selectedIndex) ||
    selectedIndex < 0 ||
    selectedIndex >= records.length ||
    typeof skipWildcardGatewayHosts !== 'boolean'
  )
    throw new Error(
      'Istio Gateway conflicts require bounded records, selected identity and boolean settings'
    );
  const groups = new Map<string, Host[]>();
  let hostCount = 0;
  records.forEach((record, recordIndex) => {
    const parsed = fields(record.spec);
    parsed.servers.forEach((server, serverIndex) => {
      if (!server) return;
      const key = JSON.stringify([parsed.selector, server.port]);
      const hosts = groups.get(key) ?? [];
      server.hosts.forEach((host, index) => {
        if (++hostCount > 2000) throw new Error('Istio Gateway context exceeds 2000 hosts');
        const parts = host.split('/');
        const namespace = parts.length > 1 ? parts[0] : '*';
        hosts.push({
          record: recordIndex,
          server: serverIndex,
          index,
          name: parts.length > 1 ? parts[1] : host,
          namespace: namespace === '.' ? record.namespace : namespace,
        });
      });
      groups.set(key, hosts);
    });
  });
  const patterns = new Map<string, RE2JS>();
  const pattern = (name: string) => {
    let compiled = patterns.get(name);
    if (!compiled) {
      compiled = RE2JS.compile(`^${name.replace(/\./g, '\\.')}$`);
      patterns.set(name, compiled);
    }
    return compiled;
  };
  const matches = (a: Host, b: Host) => {
    if (a.namespace !== b.namespace && a.namespace !== '*' && b.namespace !== '*') return false;
    if (a.name === '*' || b.name === '*') return !skipWildcardGatewayHosts;
    const x = a.name.toLowerCase();
    const y = b.name.toLowerCase();
    if (x === y) return true;
    if (x.startsWith('*.') && y.startsWith('*.')) return false;
    const first = pattern(x);
    const second = pattern(y);
    return first.matcher(y).find() || second.matcher(x).find();
  };
  const paths = new Set<string>();
  const references = new Set<number>();
  const addPath = (host: Host) => {
    if (host.record === selectedIndex)
      paths.add(`spec/servers[${host.server}]/hosts[${host.index}]`);
  };
  let comparisons = 0;
  for (const hosts of groups.values()) {
    for (let i = 0; i + 1 < hosts.length; i++) {
      const host = hosts[i];
      const peers: Host[] = [];
      for (let j = i + 1; j < hosts.length; j++) {
        if (++comparisons > 20000)
          throw new Error('Istio Gateway conflicts exceed 20000 host comparisons');
        if (matches(host, hosts[j])) peers.push(hosts[j]);
      }
      if (!peers.length) continue;
      addPath(host);
      const seen = new Set<number>();
      for (const peer of peers) {
        if (host.record === peer.record || seen.has(peer.record)) continue;
        seen.add(peer.record);
        addPath(peer);
        if (host.record === selectedIndex) references.add(peer.record);
        if (peer.record === selectedIndex) references.add(host.record);
      }
    }
  }
  return { paths: [...paths].sort(), references: [...references].sort((a, b) => a - b) };
}

export function istioGatewayConflictChecks(
  kind: string,
  group: string,
  namespace: string,
  spec: Record<string, unknown>,
  context?: ReferenceValidationContext,
  owner?: ValidationOwner
): { findings: Finding[]; skipped: string[] } {
  if (kind !== 'Gateway' || group !== 'networking.istio.io') return { findings: [], skipped: [] };
  try {
    const target = fields(spec);
    if (!istioGatewayNeedsConflicts(kind, group, spec) || owner?.name.includes('autogenerated-k8s'))
      return { findings: [], skipped: [] };
    if (!owner || !context?.istioGateways?.complete)
      throw new Error(
        'Istio Gateway conflicts require captured identity and a complete Istio Gateway list'
      );
    const records = namespacedValidationRecords(context.istioGateways.items);
    const selected = records.find(
      record => record.name === owner.name && record.namespace === namespace
    );
    if (
      !selected ||
      selected.uid !== owner.uid ||
      JSON.stringify(fields(selected.spec)) !== JSON.stringify(target)
    )
      throw new Error(
        'Istio Gateway identity, selector or host/port fields changed; reload before checking conflicts'
      );
    const visible = records.filter(record => !record.name.includes('autogenerated-k8s'));
    const result = istioGatewayHostConflicts(
      visible,
      visible.indexOf(selected),
      context.skipWildcardGatewayHosts ?? false
    );
    const references = result.references
      .map(
        (index): FindingReference => ({
          kind: 'Gateway',
          group: 'networking.istio.io',
          name: visible[index].name,
          namespace: visible[index].namespace,
          uid: visible[index].uid,
        })
      )
      .sort((a, b) =>
        JSON.stringify([a.namespace, a.name]).localeCompare(JSON.stringify([b.namespace, b.name]))
      );
    return {
      skipped: [],
      findings: result.paths.map(path => ({
        code: 'KIA0301',
        severity: 'warning',
        path,
        message: 'More than one Gateway for the same host port combination',
        references,
      })),
    };
  } catch (error) {
    return {
      findings: [],
      skipped: [
        error instanceof Error ? error.message : 'Istio Gateway conflict context is unavailable',
      ],
    };
  }
}
