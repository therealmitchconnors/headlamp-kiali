import { importsHost } from './importScope';
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

interface ServiceEntryFields {
  hosts: string[];
  ports: ({ number: number; protocol: string } | null)[];
  exportTo: string[];
}
function fields(spec: Record<string, unknown>): ServiceEntryFields {
  const hosts = spec.hosts ?? [];
  const ports = spec.ports ?? [];
  if (
    !Array.isArray(hosts) ||
    hosts.length > 100 ||
    hosts.some(
      host => typeof host !== 'string' || host.length > 1024 || /[^\u0020-\u007e]/.test(host)
    )
  )
    throw new Error('ServiceEntry checks require at most 100 bounded ASCII hosts');
  if (!Array.isArray(ports) || ports.length > 100)
    throw new Error('ServiceEntry checks require at most 100 ports');
  return {
    hosts: hosts.map(host => String(host)),
    ports: ports.map(port => {
      if (port === null) return null;
      if (!isRecord(port)) throw new Error('ServiceEntry port is malformed');
      const number = port.number ?? 0;
      const protocol = port.protocol ?? '';
      if (
        typeof number !== 'number' ||
        !Number.isInteger(number) ||
        number < 0 ||
        number > 4294967295 ||
        typeof protocol !== 'string' ||
        protocol.length > 128 ||
        /[^\u0020-\u007e]/.test(protocol)
      )
        throw new Error('ServiceEntry port requires a uint32 number and a bounded ASCII protocol');
      return { number, protocol };
    }),
    exportTo: configurationExports(spec),
  };
}
export interface ServiceEntryCollision {
  host: string;
  port: number;
  code: 'KIA1211' | 'KIA1212';
  members: { name: string; namespace: string; portIndex: number; protocol: string }[];
}

/** Grouping follows the active v2.33.0 ServiceEntry multi-match checker. */
export function serviceEntryCollisions(
  records: readonly Pick<ValidationRecord, 'name' | 'namespace' | 'spec'>[]
): ServiceEntryCollision[] {
  if (records.length > 1000) throw new Error('ServiceEntry checks exceed 1000 records');
  const groups = new Map<string, ServiceEntryCollision>();
  let contributions = 0;
  let fieldsCount = 0;
  for (const record of records) {
    const spec = fields(record.spec);
    fieldsCount += spec.hosts.length + spec.ports.length;
    if (fieldsCount > 20000) throw new Error('ServiceEntry checks exceed 20000 host/port fields');
    spec.ports.forEach((port, portIndex) => {
      if (!port) return;
      for (const host of spec.hosts) {
        if (++contributions > 10000)
          throw new Error('ServiceEntry checks exceed 10000 host/port contributions');
        const normalized = host.toLowerCase();
        const key = JSON.stringify([normalized, port.number]);
        const group = groups.get(key) ?? {
          host: normalized,
          port: port.number,
          code: 'KIA1211',
          members: [],
        };
        group.members.push({
          name: record.name,
          namespace: record.namespace,
          portIndex,
          protocol: port.protocol.toUpperCase(),
        });
        groups.set(key, group);
      }
    });
  }
  return [...groups.values()]
    .filter(group => group.members.length > 1)
    .map(group => ({
      ...group,
      code: group.members.some(member => member.protocol !== group.members[0].protocol)
        ? 'KIA1212'
        : 'KIA1211',
    }));
}

export function serviceEntryChecks(
  kind: string,
  group: string,
  namespace: string,
  spec: Record<string, unknown>,
  context?: ReferenceValidationContext,
  owner?: ValidationOwner
): { findings: Finding[]; skipped: string[] } {
  if (kind !== 'ServiceEntry' || group !== 'networking.istio.io')
    return { findings: [], skipped: [] };
  try {
    const target = fields(spec);
    if (!target.hosts.length || !target.ports.some(port => port !== null))
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
      throw new Error('ServiceEntry conflict checks require the captured namespace, name and UID');
    if (
      !context?.serviceEntries?.complete ||
      !context.namespaces.complete ||
      !context.sidecars.complete ||
      [context.serviceEntries.items, context.namespaces.items, context.sidecars.items].some(
        items => items.length > 1000
      )
    )
      throw new Error(
        'ServiceEntry conflict checks require complete bounded ServiceEntry, Namespace and Sidecar lists'
      );
    let fieldsCount = 0;
    const records = namespacedValidationRecords(context.serviceEntries.items).map(record => {
      const parsed = fields(record.spec);
      fieldsCount += parsed.hosts.length + parsed.ports.length;
      if (fieldsCount > 20000)
        throw new Error('ServiceEntry context exceeds 20000 host/port fields');
      return { ...record, parsed };
    });
    const selected = records.find(
      record => record.name === owner.name && record.namespace === namespace
    );
    if (
      !selected ||
      selected.uid !== owner.uid ||
      JSON.stringify(selected.parsed) !== JSON.stringify(target)
    )
      throw new Error(
        'ServiceEntry identity or relevant specification changed; reload before checking conflicts'
      );
    const namespaces = context.namespaces.items.map(item => item.name);
    if (!namespaces.includes(namespace))
      throw new Error('Selected namespace is missing from ServiceEntry context');
    const scope = configurationImportScope(namespace, context);
    if (scope.limited && !context.identityDomain)
      throw new Error(
        'Limited ServiceEntry imports require an explicit Service DNS identity domain'
      );
    const visible = records.filter(record => {
      return (
        configurationExportIncluded('ServiceEntry', record, namespace, context) &&
        (!scope.limited ||
          record.parsed.hosts.some(host => importsHost(scope, host, record.namespace)))
      );
    });
    if (!visible.includes(selected))
      return {
        findings: [],
        skipped: [
          'Selected ServiceEntry is not exported and imported into this namespace validation scope',
        ],
      };
    const collisions = serviceEntryCollisions(visible);
    const findings = new Map<string, Finding>();
    const byIdentity = new Map(
      visible.map(record => [JSON.stringify([record.namespace, record.name]), record])
    );
    let referenceCount = 0;
    for (const collision of collisions) {
      const own = collision.members.filter(
        member => member.name === owner.name && member.namespace === namespace
      );
      for (const portIndex of new Set(own.map(member => member.portIndex))) {
        const key = JSON.stringify([collision.code, portIndex]);
        const finding = findings.get(key) ?? {
          code: collision.code,
          severity: 'warning' as const,
          path: `spec/ports[${portIndex}]`,
          message:
            collision.code === 'KIA1212'
              ? 'ServiceEntries have conflicting protocols for the same host and port'
              : 'More than one ServiceEntry for the same host and port',
          references: [],
        };
        const references = new Map(
          (finding.references ?? []).map(reference => [
            JSON.stringify([reference.namespace, reference.name]),
            reference,
          ])
        );
        const ownCount = own.filter(member => member.portIndex === portIndex).length;
        for (const member of collision.members) {
          if (
            ownCount === 1 &&
            member.name === owner.name &&
            member.namespace === namespace &&
            member.portIndex === portIndex
          )
            continue;
          if (++referenceCount > 10000)
            throw new Error('ServiceEntry conflicts exceed the 10000-reference evaluation limit');
          const identity = JSON.stringify([member.namespace, member.name]);
          const record = byIdentity.get(identity)!;
          references.set(identity, {
            kind: 'ServiceEntry',
            group: 'networking.istio.io',
            name: record.name,
            namespace: record.namespace,
            uid: record.uid,
          });
        }
        finding.references = [...references.values()].sort((a, b) =>
          JSON.stringify([a.namespace, a.name]).localeCompare(JSON.stringify([b.namespace, b.name]))
        );
        findings.set(key, finding);
      }
    }
    return {
      findings: [...findings.values()].sort(
        (a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code)
      ),
      skipped: [],
    };
  } catch (error) {
    return {
      findings: [],
      skipped: [
        error instanceof Error ? error.message : 'Unable to evaluate ServiceEntry conflicts',
      ],
    };
  }
}
