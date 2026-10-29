import { validateIdentityDomain } from './config';
import { getHost, hostString } from './hosts';
import { validationOutboundPolicy } from './mesh';
import { isDnsLabel, isRecord } from './object';
import type { ReferenceValidationContext } from './referenceValidation';
import { registryHostLookup } from './serviceRegistry';
import type { Finding } from './validation';

function destinations(spec: Record<string, unknown>) {
  const targets: { host: string; path: string }[] = [];
  let count = 0;
  for (const protocol of ['http', 'tcp', 'tls']) {
    const rules = spec[protocol];
    if (rules === undefined || rules === null) continue;
    if (!Array.isArray(rules) || rules.length > 100)
      throw new Error('VirtualService registry checks support at most 100 routes per protocol');
    for (const [ruleIndex, rule] of rules.entries()) {
      if (rule === null) continue;
      if (!isRecord(rule)) throw new Error('Malformed VirtualService route');
      if (rule.route === undefined || rule.route === null) continue;
      if (!Array.isArray(rule.route) || rule.route.length > 100)
        throw new Error(
          'VirtualService registry checks support at most 100 destinations per route'
        );
      for (const [index, destination] of rule.route.entries()) {
        if (++count > 1000)
          throw new Error('VirtualService registry checks exceed 1000 destinations');
        if (destination === null) continue;
        if (!isRecord(destination) || !isRecord(destination.destination))
          throw new Error('Malformed VirtualService destination');
        const host = destination.destination.host;
        if (host === undefined || host === '') continue;
        if (typeof host !== 'string' || host.length > 1024)
          throw new Error('Invalid or oversized VirtualService destination host');
        targets.push({
          host,
          path: `spec/${protocol}[${ruleIndex}]/route[${index}]/destination/host`,
        });
      }
    }
  }
  return targets;
}

export function virtualServiceNeedsRegistry(
  kind: string,
  group: string,
  spec: unknown,
  domain: string | null
) {
  return (
    kind === 'VirtualService' &&
    group === 'networking.istio.io' &&
    !!domain &&
    isRecord(spec) &&
    ['http', 'tcp', 'tls'].some(
      protocol =>
        Array.isArray(spec[protocol]) &&
        spec[protocol].length <= 100 &&
        spec[protocol].some(
          rule =>
            isRecord(rule) &&
            Array.isArray(rule.route) &&
            rule.route.length <= 100 &&
            rule.route.some(
              destination =>
                isRecord(destination) &&
                isRecord(destination.destination) &&
                typeof destination.destination.host === 'string' &&
                destination.destination.host !== ''
            )
        )
    )
  );
}

export function virtualServiceRegistryChecks(
  kind: string,
  group: string,
  namespace: string,
  spec: Record<string, unknown>,
  context?: ReferenceValidationContext
): { findings: Finding[]; skipped: string[] } {
  const findings: Finding[] = [];
  const skipped: string[] = [];
  if (kind !== 'VirtualService' || group !== 'networking.istio.io') return { findings, skipped };
  try {
    const targets = destinations(spec);
    if (!targets.length) return { findings, skipped };
    if (!isDnsLabel(namespace))
      throw new Error('VirtualService registry checks require an explicit namespace');
    if (!context?.identityDomain)
      throw new Error(
        'VirtualService registry checks require an explicit Service DNS identity domain'
      );
    const domain = validateIdentityDomain(context.identityDomain);
    const visible = registryHostLookup(context, domain);
    const namespaces = context.namespaces.items.map(item => item.name);
    if (!namespaces.includes(namespace))
      throw new Error('VirtualService namespace evidence is missing');
    for (const target of targets) {
      try {
        const host = hostString(getHost(target.host, namespace, namespaces, domain));
        if (visible(host, namespace)) continue;
        const policy = validationOutboundPolicy(context.namespaceMesh?.get(namespace));
        findings.push({
          code: 'KIA1101',
          severity: policy.mode === 'ALLOW_ANY' ? 'warning' : 'error',
          path: target.path,
          message: "DestinationWeight on route doesn't have a valid service (host not found)",
        });
      } catch (error) {
        skipped.push(
          `${target.path}: ${
            error instanceof Error ? error.message : 'Destination registry is unavailable'
          }`
        );
      }
    }
  } catch (error) {
    skipped.push(
      error instanceof Error ? error.message : 'Unable to evaluate VirtualService destinations'
    );
  }
  return { findings, skipped };
}
