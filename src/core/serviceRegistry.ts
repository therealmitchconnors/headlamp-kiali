import { validateIdentityDomain } from './config';
import { trimGoSpace } from './goStrings';
import { isExportedTo } from './importScope';
import type { NamespaceMeshConfiguration } from './mesh';
import { isDnsLabel } from './object';
import type { ReferenceValidationContext, ValidationRecord } from './referenceValidation';
import {
  configurationExportIncluded,
  configurationExports,
  namespacedValidationRecords,
} from './validationScope';

type ExportScope =
  | { status: 'ready'; namespaces: string[] }
  | { status: 'unavailable'; message: string };
export type ServiceHostRegistry = ReadonlyMap<string, { namespace: string; exports: ExportScope }>;

export function serviceExportAnnotation(value: string): string[] {
  if (typeof value !== 'string' || value.length > 4096)
    throw new Error('Service export annotation is invalid or exceeds 4096 characters');
  const parts = value.split(',');
  if (parts.length > 100) throw new Error('Service export annotation exceeds 100 entries');
  return parts.map(trimGoSpace).filter(value => value !== '');
}

export function serviceHostRegistry(
  records: readonly ValidationRecord[],
  identityDomain: string,
  namespaceMesh: ReadonlyMap<string, NamespaceMeshConfiguration> | undefined
): ServiceHostRegistry {
  const domain = validateIdentityDomain(identityDomain);
  const registry = new Map<string, { namespace: string; exports: ExportScope }>();
  for (const record of namespacedValidationRecords(records)) {
    if (!isDnsLabel(record.name)) throw new Error('Service registry requires valid Service names');
    let exports: ExportScope;
    if (record.exportToAnnotation !== undefined)
      exports = { status: 'ready', namespaces: serviceExportAnnotation(record.exportToAnnotation) };
    else {
      const mesh = namespaceMesh?.get(record.namespace);
      exports =
        mesh?.status === 'ready'
          ? {
              status: 'ready',
              namespaces: configurationExports({ exportTo: mesh.fields.defaultServiceExportTo }),
            }
          : {
              status: 'unavailable',
              message:
                mesh?.status === 'unavailable'
                  ? mesh.message
                  : `Service export defaults are unresolved for ${record.namespace}`,
            };
    }
    const entry = { namespace: record.namespace, exports };
    for (const suffix of [`.${domain}`, '.svc', ''])
      registry.set(`${record.name}.${record.namespace}${suffix}`, entry);
  }
  return registry;
}

export function serviceHostVisible(
  registry: ServiceHostRegistry,
  host: string,
  namespace: string
): boolean {
  const entry = registry.get(host);
  if (!entry) return false;
  if (entry.exports.status === 'unavailable') throw new Error(entry.exports.message);
  return isExportedTo(entry.exports.namespaces, entry.namespace, namespace);
}

export function registryHostLookup(context: ReferenceValidationContext, identityDomain: string) {
  if (
    !context.namespaces.complete ||
    !context.services?.complete ||
    !context.serviceEntries?.complete
  )
    throw new Error('Registry checks require complete Namespace, Service and ServiceEntry lists');
  if (context.namespaces.items.length > 1000)
    throw new Error('Registry namespace context exceeds 1000 records');
  const registry = serviceHostRegistry(
    context.services.items,
    identityDomain,
    context.namespaceMesh
  );
  let hostCount = 0;
  const entries = namespacedValidationRecords(context.serviceEntries.items).map(record => {
    const values = record.spec.hosts;
    if (
      !Array.isArray(values) ||
      values.length > 100 ||
      values.some(value => typeof value !== 'string' || !value || value.length > 1024)
    )
      throw new Error('ServiceEntry registry hosts are malformed or exceed 100 hosts per object');
    hostCount += values.length;
    if (hostCount > 20000) throw new Error('ServiceEntry registry exceeds 20,000 hosts');
    return { record, suffixes: values.map((value: string) => value.slice(value.indexOf('*') + 1)) };
  });
  let comparisons = 0;
  return (host: string, namespace: string): boolean => {
    const matching = entries.filter(entry =>
      entry.suffixes.some(suffix => {
        if (++comparisons > 10000)
          throw new Error('Service registry exceeds 10,000 host comparisons');
        return host.endsWith(suffix);
      })
    );
    let visible = false;
    const unresolved: string[] = [];
    for (const entry of matching) {
      try {
        if (configurationExportIncluded('ServiceEntry', entry.record, namespace, context))
          visible = true;
      } catch (error) {
        unresolved.push(
          error instanceof Error ? error.message : 'ServiceEntry export scope is unavailable'
        );
      }
    }
    if (visible || serviceHostVisible(registry, host, namespace)) return true;
    if (unresolved.length) throw new Error(unresolved[0]);
    return false;
  };
}
