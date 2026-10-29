import { filterByHost, hostString, parseGatewayAsHost, parseHost } from './hosts';
import { isDnsLabel, isDnsSubdomain, isRecord } from './object';
import type { ReferenceValidationContext } from './referenceValidation';
import type { Finding } from './validation';

interface GatewayReference {
  name: string;
  path: string;
}
type GatewayReferences =
  | { complete: true; references: GatewayReference[] }
  | { complete: false; message: string };

export function virtualServiceGatewayReferences(spec: Record<string, unknown>): GatewayReferences {
  const references: GatewayReference[] = [];
  let matches = 0;
  try {
    function list(value: unknown, path: string, maximum: number): unknown[] {
      if (value === undefined) return [];
      if (!Array.isArray(value) || value.length > maximum)
        throw new Error(`${path}: invalid list or more than ${maximum} entries`);
      return value;
    }
    function gateways(value: unknown, path: string) {
      list(value, path, 200).forEach((name, index) => {
        if (typeof name !== 'string' || !name || name.length > 1024 || name.trim() !== name)
          throw new Error(`${path}[${index}]: invalid Gateway reference`);
        references.push({ name, path: `${path}[${index}]` });
        if (references.length > 200) throw new Error('Gateway reference checks exceed 200 targets');
      });
    }
    gateways(spec.gateways, 'spec/gateways');
    for (const protocol of ['http', 'tcp', 'tls']) {
      list(spec[protocol], `spec/${protocol}`, 100).forEach((route, routeIndex) => {
        if (!isRecord(route)) throw new Error(`spec/${protocol}[${routeIndex}]: invalid route`);
        list(route.match, `spec/${protocol}[${routeIndex}]/match`, 100).forEach(
          (match, matchIndex) => {
            if (++matches > 1000) throw new Error('Gateway reference checks exceed 1000 matches');
            const path = `spec/${protocol}[${routeIndex}]/match[${matchIndex}]`;
            if (!isRecord(match)) throw new Error(`${path}: invalid match`);
            gateways(match.gateways, `${path}/gateways`);
          }
        );
      });
    }
    return { complete: true, references };
  } catch (error) {
    return {
      complete: false,
      message: error instanceof Error ? error.message : 'Unable to read Gateway references',
    };
  }
}

export function istioGatewayReferenceChecks(
  kind: string,
  group: string,
  namespace: string,
  spec: Record<string, unknown>,
  context?: ReferenceValidationContext
): { findings: Finding[]; skipped: string[] } {
  const findings: Finding[] = [];
  const skipped: string[] = [];
  if (kind !== 'VirtualService' || group !== 'networking.istio.io') return { findings, skipped };
  const parsed = virtualServiceGatewayReferences(spec);
  if (parsed.complete === false) return { findings, skipped: [parsed.message] };
  const domain = context?.identityDomain ?? '';
  for (const reference of parsed.references) {
    if (reference.name === 'mesh') continue;
    const legacy = !reference.name.includes('/') && reference.name.includes('.');
    if (legacy)
      findings.push({
        code: 'KIA1108',
        severity: 'unknown',
        path: reference.path,
        message: 'Preferred nomenclature: <gateway namespace>/<gateway name>',
      });
    if (!isDnsLabel(namespace) || namespace.trim() !== namespace) {
      skipped.push(`${reference.path}: an explicit namespace is required`);
      continue;
    }
    if (legacy && !domain) {
      skipped.push(
        `${reference.path}: legacy Gateway references require an explicit Service DNS identity domain`
      );
      continue;
    }
    let target: { name: string; namespace: string } | undefined;
    if (!legacy) {
      const parts = reference.name.split('/');
      if (parts.length === 1) target = { name: parts[0], namespace };
      else if (parts.length === 2) target = { name: parts[1], namespace: parts[0] };
      if (!target || !isDnsLabel(target.namespace) || !isDnsSubdomain(target.name)) {
        skipped.push(`${reference.path}: invalid Gateway namespace/name`);
        continue;
      }
    }
    if (!context?.istioGateways?.complete || context.istioGateways.items.length > 1000) {
      skipped.push(
        `${reference.path}: Gateway checks require a complete bounded Istio Gateway list`
      );
      continue;
    }
    const found = target
      ? context.istioGateways.items.some(
          item => item.name === target.name && item.namespace === target.namespace
        )
      : context.istioGateways.items.some(item => {
          const requested = parseGatewayAsHost(reference.name, namespace, domain);
          const candidate = `${item.name}.${item.namespace}.${domain}`;
          return filterByHost(
            hostString(requested),
            requested.namespace,
            candidate,
            parseHost(candidate, namespace, domain).namespace,
            domain
          );
        });
    if (!found)
      findings.push({
        code: 'KIA1102',
        severity: 'error',
        path: reference.path,
        message: 'VirtualService is pointing to a non-existent gateway',
      });
  }
  return { findings, skipped };
}
