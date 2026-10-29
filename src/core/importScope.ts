/*
 * Port of Kiali v2.33.0 business/checkers/common/sidecar_import_scope.go.
 * This is namespace-wide configuration visibility, not per-workload enforcement.
 */
import { getHost, hostIsWildcard, hostString, hostWithinWildcardHost, IstioHost } from './hosts';
import { Labels } from './labels';
import { isRecord } from './object';

export interface ImportSidecar {
  name: string;
  namespace: string;
  spec: {
    workloadSelector?: { labels?: Labels } | null;
    egress?: readonly ({ hosts?: readonly string[] } | null)[];
  };
}
interface EgressEntry {
  namespace: string;
  dnsName: string;
  exclude: boolean;
}
export interface ImportScope {
  limited: boolean;
  namespaces: readonly string[];
  identityDomain: string;
  egress: readonly EgressEntry[];
}

export function importSidecar(
  name: string,
  namespace: string,
  spec: Record<string, unknown>
): ImportSidecar {
  const selector = spec.workloadSelector;
  if (
    selector !== undefined &&
    selector !== null &&
    (!isRecord(selector) ||
      Object.keys(selector).some(key => key !== 'labels') ||
      (selector.labels !== undefined &&
        (!isRecord(selector.labels) ||
          Object.values(selector.labels).some(value => typeof value !== 'string'))))
  )
    throw new Error('Invalid Sidecar workload selector');
  const egress = sidecarEgressListeners(spec);
  return {
    name,
    namespace,
    spec: {
      workloadSelector: isRecord(selector)
        ? {
            labels: isRecord(selector.labels)
              ? Object.fromEntries(
                  Object.entries(selector.labels).map(([key, value]) => [key, String(value)])
                )
              : undefined,
          }
        : undefined,
      egress,
    },
  };
}

export function sidecarEgressListeners(spec: Record<string, unknown>) {
  if (
    spec.egress !== undefined &&
    spec.egress !== null &&
    (!Array.isArray(spec.egress) || spec.egress.length > 100)
  )
    throw new Error('Invalid Sidecar egress listeners');
  const egress = (Array.isArray(spec.egress) ? spec.egress : []).map(listener => {
    if (listener === null) return null;
    if (!isRecord(listener) || !Array.isArray(listener.hosts))
      throw new Error('Invalid Sidecar egress hosts');
    if (
      listener.hosts.length > 1000 ||
      listener.hosts.some(
        host => typeof host !== 'string' || host.length > 1024 || !/^[^/]+\/[^/]+$/.test(host)
      )
    )
      throw new Error('Invalid or oversized Sidecar import host list');
    return { hosts: listener.hosts.map(host => String(host)) };
  });
  if (
    egress.length > 100 ||
    egress.reduce((sum, listener) => sum + (listener?.hosts.length ?? 0), 0) > 1000
  )
    throw new Error('Sidecar import scope exceeds 100 listeners or 1,000 hosts');
  return egress;
}

export function namespaceSidecars(namespace: string, sidecars: readonly (ImportSidecar | null)[]) {
  return sidecars.filter(
    (sidecar): sidecar is ImportSidecar =>
      !!sidecar &&
      sidecar.namespace === namespace &&
      !Object.keys(sidecar.spec.workloadSelector?.labels ?? {}).length
  );
}

export function effectiveSidecar(
  workloadNamespace: string,
  rootNamespace: string,
  sidecars: readonly (ImportSidecar | null)[]
): ImportSidecar | undefined {
  return (
    namespaceSidecars(workloadNamespace, sidecars)[0] ??
    (rootNamespace && rootNamespace !== workloadNamespace
      ? namespaceSidecars(rootNamespace, sidecars)[0]
      : undefined)
  );
}

export function newImportScope(
  workloadNamespace: string,
  rootNamespace: string,
  sidecars: readonly (ImportSidecar | null)[],
  namespaces: readonly string[],
  identityDomain: string
): ImportScope {
  const sidecar = workloadNamespace
    ? effectiveSidecar(workloadNamespace, rootNamespace, sidecars)
    : undefined;
  const egress: EgressEntry[] = [];
  for (const listener of sidecar?.spec.egress ?? []) {
    for (const host of listener?.hosts ?? []) {
      const slash = host.indexOf('/');
      if (slash < 0) continue;
      let namespace = host.slice(0, slash);
      const exclude = namespace.startsWith('~');
      if (exclude) namespace = namespace.slice(1) || '*';
      if (namespace === '.') namespace = workloadNamespace;
      egress.push({ namespace, dnsName: host.slice(slash + 1), exclude });
    }
  }
  return { limited: egress.length > 0, namespaces, identityDomain, egress };
}

function dnsMatches(pattern: string, host: IstioHost, raw: string): boolean {
  if (pattern === '*' || pattern === raw) return true;
  if (host.completeInput) {
    const fqdn = hostString(host);
    return (
      pattern === fqdn ||
      pattern === host.service ||
      pattern === `${host.service}.${host.namespace}` ||
      hostWithinWildcardHost(fqdn, pattern) ||
      hostWithinWildcardHost(raw, pattern) ||
      (hostIsWildcard(host) && hostWithinWildcardHost(pattern, fqdn))
    );
  }
  return pattern === host.service || hostWithinWildcardHost(host.service, pattern);
}

export function importsHost(scope: ImportScope, raw: string, configNamespace: string): boolean {
  if (!scope.limited) return true;
  if (!raw) return false;
  const host = getHost(raw, configNamespace, scope.namespaces, scope.identityDomain);
  const matches = (entry: EgressEntry) =>
    (entry.namespace === '*' ||
      entry.namespace === (host.completeInput ? host.namespace : configNamespace)) &&
    dnsMatches(entry.dnsName, host, raw);
  return (
    scope.egress.some(entry => !entry.exclude && matches(entry)) &&
    !scope.egress.some(entry => entry.exclude && matches(entry))
  );
}

/** Runtime visibility helper from kubernetes.IsExportedTo; not validator inclusion. */
export function isExportedTo(
  exports: readonly string[],
  resourceNamespace: string,
  viewerNamespace: string
) {
  return (
    !exports.length ||
    exports.some(
      value =>
        value === '*' ||
        (value === '.' && resourceNamespace === viewerNamespace) ||
        (value !== '.' && value !== '~' && value === viewerNamespace)
    )
  );
}

/** The pinned validator includes bad namespace references so their findings remain visible. */
export function validationExportIncluded(
  exports: readonly string[],
  resourceNamespace: string,
  viewerNamespace: string,
  namespaces: readonly string[],
  ambientSource: boolean
) {
  if (ambientSource) return resourceNamespace === viewerNamespace;
  return (
    !exports.length ||
    exports.some(
      value =>
        value === '*' ||
        value === viewerNamespace ||
        (value === '.' && resourceNamespace === viewerNamespace) ||
        (value !== '.' && value !== '*' && !namespaces.includes(value))
    )
  );
}
