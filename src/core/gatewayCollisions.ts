import { isRecord } from './object';
import type { ReferenceValidationContext, ValidationOwner } from './referenceValidation';
import type { Finding, FindingReference } from './validation';
import { namespacedValidationRecords } from './validationScope';

export function gatewayCollisionFields(spec: Record<string, unknown>) {
  const rawListeners = spec.listeners ?? [];
  const rawAddresses = spec.addresses ?? [];
  if (
    !Array.isArray(rawListeners) ||
    rawListeners.length > 64 ||
    !Array.isArray(rawAddresses) ||
    rawAddresses.length > 16
  )
    throw new Error(
      'Gateway collision checks require at most 64 listeners and 16 addresses per object'
    );
  const listeners = rawListeners.map(listener => {
    if (
      !isRecord(listener) ||
      typeof listener.name !== 'string' ||
      typeof listener.port !== 'number' ||
      !Number.isInteger(listener.port) ||
      listener.port < 1 ||
      listener.port > 65535 ||
      typeof listener.protocol !== 'string' ||
      listener.protocol.length > 256 ||
      (listener.hostname !== undefined &&
        listener.hostname !== null &&
        (typeof listener.hostname !== 'string' || listener.hostname.length > 1024))
    )
      throw new Error('Malformed Gateway listener prevents collision checks');
    return {
      name: listener.name,
      hostname: listener.hostname ?? null,
      port: listener.port,
      protocol: listener.protocol,
    };
  });
  const addresses = rawAddresses.map(address => {
    if (
      !isRecord(address) ||
      typeof address.value !== 'string' ||
      address.value.length > 1024 ||
      (address.type !== undefined &&
        address.type !== null &&
        (typeof address.type !== 'string' || address.type.length > 256))
    )
      throw new Error('Malformed Gateway address prevents collision checks');
    return { type: address.type ?? null, value: address.value };
  });
  return { listeners, addresses };
}
export function gatewayNeedsCollisionContext(kind: string, group: string, spec: unknown): boolean {
  if (kind !== 'Gateway' || group !== 'gateway.networking.k8s.io' || !isRecord(spec)) return false;
  return (
    (Array.isArray(spec.listeners) &&
      spec.listeners.some(value => isRecord(value) && typeof value.hostname === 'string')) ||
    (Array.isArray(spec.addresses) &&
      spec.addresses.some(
        value =>
          isRecord(value) &&
          typeof value.type === 'string' &&
          typeof value.value === 'string' &&
          value.value !== ''
      ))
  );
}
export function gatewayCollisionChecks(
  kind: string,
  group: string,
  namespace: string,
  spec: Record<string, unknown>,
  context?: ReferenceValidationContext,
  owner?: ValidationOwner
): { findings: Finding[]; skipped: string[] } {
  if (kind !== 'Gateway' || group !== 'gateway.networking.k8s.io')
    return { findings: [], skipped: [] };
  try {
    const selected = gatewayCollisionFields(spec);
    if (!gatewayNeedsCollisionContext(kind, group, spec)) return { findings: [], skipped: [] };
    if (!owner || !context?.gateways?.complete)
      throw new Error(
        'Gateway collision checks require captured identity and a complete Gateway API list'
      );
    const records = namespacedValidationRecords(context.gateways.items);
    const current = records.find(
      record => record.name === owner.name && record.namespace === namespace
    );
    if (
      !current ||
      current.uid !== owner.uid ||
      JSON.stringify(gatewayCollisionFields(current.spec)) !== JSON.stringify(selected)
    )
      throw new Error(
        'Selected Gateway identity, listeners or addresses changed; reload before checking conflicts'
      );
    const listenerIndex = new Map<string, Map<string, FindingReference>>();
    const addressIndex = new Map<string, Map<string, FindingReference>>();
    let entries = 0;
    for (const record of records) {
      const fields = gatewayCollisionFields(record.spec);
      entries += fields.listeners.length + fields.addresses.length;
      if (entries > 20000)
        throw new Error('Gateway collision context exceeds 20000 listener/address entries');
      if (record.name === owner.name) continue;
      const reference: FindingReference = {
        group: 'gateway.networking.k8s.io',
        kind: 'Gateway',
        namespace: record.namespace,
        name: record.name,
        uid: record.uid,
      };
      for (const listener of fields.listeners) {
        if (listener.hostname === null) continue;
        const key = JSON.stringify([listener.hostname, listener.port, listener.protocol]);
        const matches = listenerIndex.get(key) ?? new Map<string, FindingReference>();
        matches.set(record.uid, reference);
        listenerIndex.set(key, matches);
      }
      for (const address of fields.addresses) {
        if (address.type === null || !address.value) continue;
        const key = JSON.stringify([address.type, address.value]);
        const matches = addressIndex.get(key) ?? new Map<string, FindingReference>();
        matches.set(record.uid, reference);
        addressIndex.set(key, matches);
      }
    }
    const findings: Finding[] = [];
    const addresses = new Map<string, FindingReference>();
    for (const address of selected.addresses) {
      if (address.type === null || !address.value) continue;
      for (const reference of addressIndex
        .get(JSON.stringify([address.type, address.value]))
        ?.values() ?? [])
        addresses.set(reference.uid, reference);
    }
    if (addresses.size)
      findings.push({
        code: 'KIA1502',
        severity: 'warning',
        path: 'spec/addresses/value',
        message: 'More than one K8s Gateway for the same address and type combination',
        references: [...addresses.values()],
      });
    selected.listeners.forEach((listener, index) => {
      if (listener.hostname === null) return;
      const references = listenerIndex.get(
        JSON.stringify([listener.hostname, listener.port, listener.protocol])
      );
      if (references?.size)
        findings.push({
          code: 'KIA1501',
          severity: 'warning',
          path: `spec/listeners[${index}]/hostname`,
          message: 'More than one K8s Gateway for the same host port combination',
          references: [...references.values()],
        });
    });
    return {
      findings,
      skipped: [
        'Gateway collision checks compare exact configured fields, exclude equal Gateway names across namespaces, and do not infer listener attachment or address allocation',
      ],
    };
  } catch (error) {
    return {
      findings: [],
      skipped: [
        error instanceof Error ? error.message : 'Gateway collision context is unavailable',
      ],
    };
  }
}
