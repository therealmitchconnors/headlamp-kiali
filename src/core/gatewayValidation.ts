import { GatewayRouteReference,gatewayRouteReferences } from './configuration';
import { decodeLabelSelector, matchesSelector } from './labels';
import { isDnsLabel, isDnsSubdomain, isRecord } from './object';
import type {
  ReferenceValidationContext,
  ValidationRecord,
  ValidationSourceKey,
} from './referenceValidation';
import type { Finding } from './validation';

const GROUP = 'gateway.networking.k8s.io';
const supported = (kind: string, group: string) =>
  group === GROUP && ['HTTPRoute', 'GRPCRoute'].includes(kind);

function reference(entry: GatewayRouteReference, namespace: string) {
  if (!isRecord(entry.value)) throw new Error('Malformed route reference');
  const value = entry.value;
  const kind = value.kind ?? entry.defaultKind;
  const group = value.group ?? (entry.defaultKind === 'Gateway' ? GROUP : '');
  const targetNamespace = value.namespace ?? namespace;
  if (
    typeof kind !== 'string' ||
    typeof group !== 'string' ||
    typeof value.name !== 'string' ||
    !isDnsLabel(targetNamespace)
  )
    throw new Error('Invalid route reference identity');
  return { kind, group, name: value.name, namespace: targetNamespace };
}

export function gatewayValidationSources(
  kind: string,
  group: string,
  namespace: string,
  spec: Record<string, unknown>
) {
  const keys = new Set<ValidationSourceKey>();
  if (!supported(kind, group)) return [];
  for (const entry of gatewayRouteReferences(spec)) {
    if (!isRecord(entry.value)) continue;
    const refKind = entry.value.kind ?? entry.defaultKind;
    const refGroup = entry.value.group ?? (entry.defaultKind === 'Gateway' ? GROUP : '');
    if (refKind === 'Gateway' && refGroup === GROUP && entry.defaultKind === 'Gateway') {
      keys.add('gateways');
      if (entry.value.namespace !== undefined && entry.value.namespace !== namespace)
        keys.add('namespaces');
    } else if (refKind === 'Service' && refGroup === '') {
      keys.add('services');
      if (entry.value.namespace !== undefined && entry.value.namespace !== namespace)
        keys.add('referenceGrants');
    }
  }
  return [...keys];
}

function sharedWithNamespace(gateway: ValidationRecord, namespace: ValidationRecord): boolean {
  const listeners = gateway.spec.listeners ?? [];
  if (!Array.isArray(listeners) || listeners.length > 64)
    throw new Error('Invalid or oversized Gateway listener list');
  let invalid: string | undefined;
  for (const listener of listeners) {
    if (!isRecord(listener)) {
      invalid = 'Malformed Gateway listener';
      continue;
    }
    const routes = listener.allowedRoutes;
    if (routes === undefined || routes === null) continue;
    if (!isRecord(routes)) {
      invalid = 'Malformed Gateway allowedRoutes';
      continue;
    }
    const namespaces = routes.namespaces;
    if (namespaces === undefined || namespaces === null) continue;
    if (!isRecord(namespaces)) {
      invalid = 'Malformed Gateway allowed namespaces';
      continue;
    }
    if (namespaces.from === 'All') return true;
    if (namespaces.from === undefined || namespaces.from === 'Same') continue;
    if (namespaces.from !== 'Selector') {
      invalid = 'Unsupported Gateway namespace selection';
      continue;
    }
    try {
      if (matchesSelector(namespace.labels, decodeLabelSelector(namespaces.selector))) return true;
    } catch (error) {
      invalid = error instanceof Error ? error.message : 'Invalid Gateway namespace selector';
    }
  }
  if (invalid) throw new Error(invalid);
  return false;
}

export function matchingReferenceGrant(
  grants: readonly ValidationRecord[],
  from: { namespace: string; kind: string; group: string },
  to: { namespace: string; kind: string; group: string; name: string }
): boolean {
  let invalid = false;
  for (const grant of grants) {
    if (grant.namespace !== to.namespace) continue;
    const sources = grant.spec.from;
    const targets = grant.spec.to;
    if (
      !Array.isArray(sources) ||
      !Array.isArray(targets) ||
      sources.length > 100 ||
      targets.length > 100
    ) {
      invalid = true;
      continue;
    }
    if (
      sources.some(
        source =>
          !isRecord(source) ||
          typeof source.group !== 'string' ||
          typeof source.kind !== 'string' ||
          !isDnsLabel(source.namespace)
      ) ||
      targets.some(
        target =>
          !isRecord(target) ||
          typeof target.group !== 'string' ||
          typeof target.kind !== 'string' ||
          (target.name !== undefined && !isDnsSubdomain(target.name))
      )
    ) {
      invalid = true;
      continue;
    }
    if (
      sources.some(
        source =>
          isRecord(source) &&
          source.group === from.group &&
          source.kind === from.kind &&
          source.namespace === from.namespace
      ) &&
      targets.some(
        target =>
          isRecord(target) &&
          target.group === to.group &&
          target.kind === to.kind &&
          (target.name === undefined || target.name === to.name)
      )
    )
      return true;
  }
  if (invalid)
    throw new Error('Malformed ReferenceGrant prevents proving cross-namespace permission');
  return false;
}

export function gatewayReferenceValidation(
  kind: string,
  group: string,
  namespace: string,
  spec: Record<string, unknown>,
  context?: ReferenceValidationContext
): { findings: Finding[]; skipped: string[] } {
  const findings: Finding[] = [];
  const skipped: string[] = [];
  if (!supported(kind, group)) return { findings, skipped };
  const entries = gatewayRouteReferences(spec);
  if (entries.length > 200)
    return { findings, skipped: ['Gateway reference checks exceed the 200-reference limit'] };
  for (const entry of entries) {
    const path = entry.path.replace(/\./g, '/') + '/name';
    try {
      const ref = reference(entry, namespace);
      if (ref.kind === 'Gateway' && ref.group === GROUP && entry.defaultKind === 'Gateway') {
        if (!context?.gateways?.complete)
          throw new Error('Gateway parent checks require a complete Gateway API list');
        const gateway = context.gateways.items.find(
          item => item.name === ref.name && item.namespace === ref.namespace
        );
        let allowed = !!gateway;
        if (gateway && ref.namespace !== namespace) {
          if (!context.namespaces.complete)
            throw new Error('Cross-namespace Gateway sharing requires complete namespace labels');
          const routeNamespace = context.namespaces.items.find(item => item.name === namespace);
          if (!routeNamespace)
            throw new Error('Route namespace is missing from namespace evidence');
          allowed = sharedWithNamespace(gateway, routeNamespace);
        }
        if (!allowed)
          findings.push({
            code: 'KIA1401',
            severity: 'error',
            path: `${path}/${ref.name}`,
            message: 'Route is pointing to a non-existent or inaccessible K8s gateway',
          });
      } else if (ref.kind === 'Service' && ref.group === '') {
        if (!isDnsLabel(ref.name)) {
          findings.push({
            code: 'KIA1402',
            severity: 'error',
            path,
            message: "Reference doesn't have a valid service (Service name not found)",
          });
          continue;
        }
        if (!context?.services?.complete)
          throw new Error('Service reference checks require a complete Service list');
        const service = context.services.items.some(
          item => item.name === ref.name && item.namespace === ref.namespace
        );
        let allowed = true;
        if (service && ref.namespace !== namespace) {
          if (!context.referenceGrants?.complete)
            throw new Error('Cross-namespace Service references require complete ReferenceGrants');
          allowed = matchingReferenceGrant(
            context.referenceGrants.items,
            { namespace, kind, group },
            ref
          );
        }
        if (!service || !allowed)
          findings.push({
            code: 'KIA1402',
            severity: 'error',
            path,
            message: service
              ? 'Cross-namespace Service reference is not permitted by a matching ReferenceGrant'
              : "Reference doesn't have a valid service (Service name not found)",
          });
      } else {
        skipped.push(`${path}: reference group/kind ${ref.group}/${ref.kind} is not evaluated`);
      }
    } catch (error) {
      skipped.push(
        `${path}: ${error instanceof Error ? error.message : 'Reference context is unavailable'}`
      );
    }
  }
  if (entries.length)
    skipped.push(
      'Gateway listener attachment, protocol/hostname intersections and Service port validity are not evaluated'
    );
  return { findings, skipped };
}
