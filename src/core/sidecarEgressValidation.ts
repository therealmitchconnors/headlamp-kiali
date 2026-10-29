import { validateIdentityDomain } from './config';
import { hostIsWildcard, hostString, parseHost } from './hosts';
import { sidecarEgressListeners } from './importScope';
import { isDnsLabel, isRecord } from './object';
import type { ReferenceValidationContext } from './referenceValidation';
import { registryHostLookup } from './serviceRegistry';
import type { Finding } from './validation';

export function sidecarNeedsRegistry(
  kind: string,
  group: string,
  spec: unknown,
  identityDomain: string | null
): boolean {
  return (
    kind === 'Sidecar' &&
    group === 'networking.istio.io' &&
    !!identityDomain &&
    isRecord(spec) &&
    Array.isArray(spec.egress) &&
    spec.egress.length <= 100 &&
    spec.egress.some(
      listener =>
        isRecord(listener) &&
        Array.isArray(listener.hosts) &&
        listener.hosts.length <= 1000 &&
        listener.hosts.some(host => typeof host === 'string' && host.split('/')[1] !== '*')
    )
  );
}

export function sidecarEgressChecks(
  kind: string,
  group: string,
  namespace: string,
  spec: Record<string, unknown>,
  context?: ReferenceValidationContext
): { findings: Finding[]; skipped: string[] } {
  const findings: Finding[] = [];
  const skipped: string[] = [];
  if (kind !== 'Sidecar' || group !== 'networking.istio.io') return { findings, skipped };
  try {
    const targets = sidecarEgressListeners(spec)
      .flatMap((listener, listenerIndex) =>
        (listener?.hosts ?? []).map((host, hostIndex) => ({
          dnsName: host.split('/')[1],
          path: `spec/egress[${listenerIndex}]/hosts[${hostIndex}]`,
        }))
      )
      .filter(target => target.dnsName !== '*');
    if (!targets.length) return { findings, skipped };
    if (!isDnsLabel(namespace) || namespace.trim() !== namespace)
      throw new Error('Sidecar egress checks require an explicit valid namespace');
    if (!context?.identityDomain)
      throw new Error('Sidecar egress checks require an explicit Service DNS identity domain');
    const identityDomain = validateIdentityDomain(context.identityDomain);
    const hosts = targets
      .map(target => ({
        ...target,
        host: parseHost(target.dnsName, namespace, identityDomain),
      }))
      .filter(target => !(hostIsWildcard(target.host) && target.host.namespace === namespace));
    if (!hosts.length) return { findings, skipped };
    if (
      !context.namespaces.complete ||
      !context.services?.complete ||
      !context.serviceEntries?.complete
    )
      throw new Error(
        'Sidecar egress checks require complete Namespace, Service and ServiceEntry lists'
      );
    if (
      context.namespaces.items.length > 1000 ||
      !context.namespaces.items.some(item => item.name === namespace)
    )
      throw new Error('Sidecar namespace evidence is missing or oversized');
    const visible = registryHostLookup(context, identityDomain);
    for (const target of hosts) {
      try {
        const host = hostString(target.host);
        if (visible(host, namespace)) continue;
        findings.push({
          code: 'KIA1004',
          severity: 'warning',
          path: target.path,
          message: 'This host has no matching entry in the service registry',
        });
      } catch (error) {
        skipped.push(
          `${target.path}: ${
            error instanceof Error ? error.message : 'Registry visibility is unavailable'
          }`
        );
      }
    }
  } catch (error) {
    skipped.push(
      error instanceof Error ? error.message : 'Unable to evaluate Sidecar egress hosts'
    );
  }
  return { findings, skipped };
}
