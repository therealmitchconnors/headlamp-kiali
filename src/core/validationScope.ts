import {
  ImportScope,
  importSidecar,
  namespaceSidecars,
  newImportScope,
  validationExportIncluded,
} from './importScope';
import { validationMeshRoot } from './mesh';
import { isDnsLabel, isDnsSubdomain } from './object';
import type { ReferenceValidationContext, ValidationRecord } from './referenceValidation';

export function namespacedValidationRecords(records: readonly ValidationRecord[]) {
  if (records.length > 1000) throw new Error('Configuration context exceeds 1000 records');
  const identities = new Set<string>();
  const uids = new Set<string>();
  return records.map(record => {
    const uid = record.uid;
    const identity = JSON.stringify([record.namespace, record.name]);
    if (
      !isDnsSubdomain(record.name) ||
      record.name.trim() !== record.name ||
      !isDnsLabel(record.namespace) ||
      record.namespace.trim() !== record.namespace ||
      typeof uid !== 'string' ||
      !uid ||
      uid.length > 1024 ||
      uid.trim() !== uid ||
      identities.has(identity) ||
      uids.has(uid)
    )
      throw new Error('Configuration context has invalid or duplicate object identities');
    identities.add(identity);
    uids.add(uid);
    return { ...record, uid };
  });
}

export function configurationExports(spec: Record<string, unknown>): string[] {
  const exports = spec.exportTo ?? [];
  if (
    !Array.isArray(exports) ||
    exports.length > 100 ||
    exports.some(value => typeof value !== 'string' || value.length > 1024)
  )
    throw new Error('Invalid or oversized exportTo namespace list');
  return exports.map(value => String(value));
}

export function configurationExportIncluded(
  kind: 'ServiceEntry' | 'DestinationRule' | 'VirtualService',
  record: ValidationRecord,
  namespace: string,
  context: ReferenceValidationContext
): boolean {
  const source = context.namespaces.items.find(item => item.name === record.namespace);
  if (!source) throw new Error(`${kind} namespace is missing from namespace evidence`);
  const ambient = source.labels['istio.io/dataplane-mode'] === 'ambient';
  let exports = configurationExports(record.spec);
  if (!exports.length && !ambient) {
    const mesh = context.namespaceMesh?.get(record.namespace);
    if (mesh?.status !== 'ready')
      throw new Error(
        mesh?.status === 'unavailable'
          ? mesh.message
          : `${kind} export defaults are unresolved for ${record.namespace}`
      );
    exports =
      (kind === 'ServiceEntry'
        ? mesh.fields.defaultServiceExportTo
        : kind === 'VirtualService'
        ? mesh.fields.defaultVirtualServiceExportTo
        : mesh.fields.defaultDestinationRuleExportTo) ?? [];
  }
  return validationExportIncluded(
    exports,
    record.namespace,
    namespace,
    context.namespaces.items.map(item => item.name),
    ambient
  );
}

export function configurationImportScope(
  namespace: string,
  context: ReferenceValidationContext
): ImportScope {
  if (
    context.namespaces.items.some(
      item => item.name === namespace && item.labels['istio.io/dataplane-mode'] === 'ambient'
    )
  )
    return newImportScope(namespace, '', [], [], context.identityDomain ?? '');
  let hostCount = 0;
  const sidecars = context.sidecars.items.map(item => {
    const sidecar = importSidecar(item.name, item.namespace, item.spec);
    hostCount += (sidecar.spec.egress ?? []).reduce(
      (sum, listener) => sum + (listener?.hosts?.length ?? 0),
      0
    );
    if (hostCount > 10000) throw new Error('Sidecar context exceeds the 10,000-import-host limit');
    return sidecar;
  });
  const local = namespaceSidecars(namespace, sidecars);
  if (local.length > 1)
    throw new Error('Conflicting namespace-wide Sidecars prevent import-scope evaluation');
  const mesh = context.namespaceMesh?.get(namespace);
  const root =
    mesh?.status === 'ready' && (mesh.root || isDnsLabel(mesh.fields.rootNamespace))
      ? validationMeshRoot(mesh)
      : undefined;
  if (!local.length) {
    const anyWide = sidecars.some(
      sidecar => !Object.keys(sidecar.spec.workloadSelector?.labels ?? {}).length
    );
    if (anyWide && !isDnsLabel(root))
      throw new Error(
        mesh?.status === 'unavailable'
          ? mesh.message
          : 'A resolved mesh root namespace is required for root Sidecar fallback'
      );
    if (root && namespaceSidecars(root, sidecars).length > 1)
      throw new Error('Conflicting root-namespace Sidecars prevent import-scope evaluation');
  }
  return newImportScope(
    namespace,
    root ?? '',
    sidecars,
    context.namespaces.items.map(item => item.name),
    context.identityDomain ?? ''
  );
}
