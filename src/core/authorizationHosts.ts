import { validateIdentityDomain } from './config';
import { trimGoSpace } from './goStrings';
import { getHost, hostString, hostWithinWildcardHost, IstioHost, parseHost } from './hosts';
import { validationOutboundPolicy } from './mesh';
import { isDnsLabel, isRecord } from './object';
import type { ReferenceValidationContext } from './referenceValidation';
import { registryHostLookup } from './serviceRegistry';
import type { Finding } from './validation';
import { configurationExportIncluded, namespacedValidationRecords } from './validationScope';

function hostTargets(spec: Record<string, unknown>) {
  const targets: { host: string; path: string }[] = [];
  let groups = 0;
  function list(value: unknown, path: string, maximum: number): unknown[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > maximum)
      throw new Error(`${path}: invalid list or more than ${maximum} entries`);
    return value;
  }
  list(spec.rules, 'spec/rules', 100).forEach((rule, ruleIndex) => {
    if (rule === null) return;
    if (!isRecord(rule)) throw new Error('Invalid AuthorizationPolicy rule');
    const path = `spec/rules[${ruleIndex}]/to`;
    list(rule.to, path, 100).forEach((to, toIndex) => {
      if (++groups > 1000) throw new Error('Authorization host checks exceed 1000 rule groups');
      if (to === null) return;
      if (!isRecord(to)) throw new Error(`${path}[${toIndex}]: invalid operation group`);
      if (to.operation === undefined || to.operation === null) return;
      if (!isRecord(to.operation)) throw new Error(`${path}[${toIndex}]: invalid operation`);
      const location = `${path}[${toIndex}]/operation/hosts`;
      list(to.operation.hosts, location, 200).forEach((host, index) => {
        if (typeof host !== 'string' || host.length > 1024)
          throw new Error(`${location}[${index}]: invalid or oversized host`);
        targets.push({ host, path: `${location}[${index}]` });
        if (targets.length > 200) throw new Error('Authorization host checks exceed 200 hosts');
      });
    });
  });
  return targets;
}

export function authorizationHostHeaderMatcher(
  host: string,
  namespace: string,
  namespaces?: readonly string[]
): boolean | undefined {
  const value = trimGoSpace(host);
  if (!value) return false;
  if (value.startsWith('*') || value.endsWith('*')) return true;
  const parts = value.split('.');
  if (parts.length >= 3) return true;
  if (parts.length === 2) {
    if (parts[1] === namespace) return false;
    return namespaces === undefined ? undefined : !namespaces.includes(parts[1]);
  }
  return false;
}

export function authorizationHostsNeedContext(
  kind: string,
  group: string,
  spec: unknown,
  namespace: string,
  namespaces?: readonly string[]
): boolean {
  if (
    kind !== 'AuthorizationPolicy' ||
    group !== 'security.istio.io' ||
    !isRecord(spec) ||
    !isDnsLabel(namespace)
  )
    return false;
  try {
    return hostTargets(spec).some(
      target => authorizationHostHeaderMatcher(target.host, namespace, namespaces) !== true
    );
  } catch {
    // The checker reports malformed targets; don't fetch registry context for them.
    return false;
  }
}

export function authorizationVirtualServiceHostMatch(
  host: IstioHost,
  value: string,
  namespace: string,
  domain: string
): boolean {
  if (
    value === '*' ||
    (value === host.service && namespace === host.namespace) ||
    value === `${host.service}.${host.namespace}` ||
    value === `${host.service}.${host.namespace}.${domain}` ||
    value === `*.${host.namespace}.${domain}`
  )
    return true;
  const parsed = parseHost(value, namespace, domain);
  return (
    (!host.completeInput && !parsed.completeInput && parsed.service === host.service) ||
    hostWithinWildcardHost(host.service, value)
  );
}

export function authorizationHostChecks(
  kind: string,
  group: string,
  namespace: string,
  spec: Record<string, unknown>,
  context?: ReferenceValidationContext
): { findings: Finding[]; skipped: string[] } {
  const findings: Finding[] = [];
  const skipped: string[] = [];
  if (kind !== 'AuthorizationPolicy' || group !== 'security.istio.io') return { findings, skipped };
  try {
    const targets = hostTargets(spec).filter(
      target => authorizationHostHeaderMatcher(target.host, namespace) !== true
    );
    if (!targets.length) return { findings, skipped };
    if (!isDnsLabel(namespace))
      throw new Error('Authorization host checks require an explicit namespace');
    if (!context?.namespaces.complete || context.namespaces.items.length > 1000)
      throw new Error('Authorization host checks require a complete bounded namespace list');
    const namespaces = context.namespaces.items.map(item => item.name);
    if (!namespaces.includes(namespace))
      throw new Error('AuthorizationPolicy namespace evidence is missing');
    const selected = targets.filter(
      target => !authorizationHostHeaderMatcher(target.host, namespace, namespaces)
    );
    if (!selected.length) return { findings, skipped };
    if (!context.identityDomain)
      throw new Error(
        'Authorization host registry checks require an explicit Service DNS identity domain'
      );
    const domain = validateIdentityDomain(context.identityDomain);
    if (!context.virtualServices?.complete)
      throw new Error('Authorization host checks require a complete VirtualService list');
    const registry = registryHostLookup(context, domain);
    let total = 0;
    const virtualServices = namespacedValidationRecords(context.virtualServices.items)
      .filter(record => !record.name.includes('autogenerated-k8s'))
      .map(record => {
        const hosts = record.spec.hosts ?? [];
        if (
          !Array.isArray(hosts) ||
          hosts.length > 100 ||
          hosts.some(host => typeof host !== 'string' || host.length > 1024)
        )
          throw new Error(
            'VirtualService registry hosts are malformed or exceed 100 hosts per object'
          );
        total += hosts.length;
        if (total > 20000) throw new Error('VirtualService registry exceeds 20,000 hosts');
        return { record, hosts: hosts.map(String) };
      });
    let comparisons = 0;
    for (const target of selected) {
      try {
        const host = getHost(target.host, namespace, namespaces, domain);
        let visible = false;
        const unresolved: string[] = [];
        for (const entry of virtualServices) {
          const matches = entry.hosts.some(value => {
            if (++comparisons > 10000)
              throw new Error('Authorization host checks exceed 10,000 VirtualService comparisons');
            return authorizationVirtualServiceHostMatch(
              host,
              value,
              entry.record.namespace,
              domain
            );
          });
          if (!matches) continue;
          try {
            if (configurationExportIncluded('VirtualService', entry.record, namespace, context)) {
              visible = true;
              break;
            }
          } catch (error) {
            unresolved.push(
              error instanceof Error ? error.message : 'VirtualService visibility is unavailable'
            );
          }
        }
        if (visible || registry(hostString(host), namespace)) continue;
        if (unresolved.length) throw new Error(unresolved[0]);
        const policy = validationOutboundPolicy(context.namespaceMesh?.get(namespace));
        findings.push({
          code: 'KIA0104',
          severity: policy.mode === 'ALLOW_ANY' ? 'warning' : 'error',
          path: target.path,
          message: 'This host has no matching entry in the service registry',
        });
      } catch (error) {
        skipped.push(
          `${target.path}: ${
            error instanceof Error ? error.message : 'Authorization host registry is unavailable'
          }`
        );
      }
    }
  } catch (error) {
    skipped.push(error instanceof Error ? error.message : 'Unable to evaluate authorization hosts');
  }
  return { findings, skipped };
}
