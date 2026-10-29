/*
 * Port of Kiali v2.33.0 kubernetes/host.go and the host helpers in filters.go.
 * identityDomain is the service DNS suffix, not a Headlamp or telemetry cluster ID.
 */
export interface IstioHost {
  service: string;
  namespace: string;
  identityDomain: string;
  completeInput: boolean;
}

export function parseHost(hostName: string, namespace: string, identityDomain: string): IstioHost {
  const parts = hostName.split('.');
  if (parts.length === 1)
    return { service: hostName, namespace, identityDomain, completeInput: true };
  if (parts.length > 2 && parts.slice(2).join('.') === identityDomain)
    return { service: parts[0], namespace: parts[1], identityDomain, completeInput: true };
  return { service: hostName, namespace: '', identityDomain: '', completeInput: false };
}

export function getHost(
  hostName: string,
  namespace: string,
  namespaces: readonly string[],
  identityDomain: string
): IstioHost {
  const parts = hostName.split('.');
  if (
    (parts.length === 2 && (parts[1] === namespace || namespaces.includes(parts[1]))) ||
    (parts.length === 3 && parts[2] === 'svc')
  )
    return { service: parts[0], namespace: parts[1], identityDomain, completeInput: true };
  return parseHost(hostName, namespace, identityDomain);
}

export function hostString(host: IstioHost): string {
  if (!host.completeInput) return host.service;
  return `${host.service}.${host.namespace}${host.identityDomain ? `.${host.identityDomain}` : ''}`;
}

export function hostIsWildcard(host: IstioHost): boolean {
  return host.service.startsWith('*');
}

export function parseTwoPartHost(host: IstioHost): { service: string; namespace: string } {
  const parts = host.service.split('.');
  return !host.completeInput && parts.length > 1
    ? { service: parts[0], namespace: parts[1] }
    : { service: host.service, namespace: host.namespace };
}

export function filterByHost(
  host: string,
  hostNamespace: string,
  service: string,
  namespace: string,
  identityDomain: string
): boolean {
  return (
    (host === service && hostNamespace === namespace) ||
    host === `${service}.${namespace}` ||
    host === `${service}.${namespace}.svc` ||
    host === `${service}.${namespace}.${identityDomain}`
  );
}

export function normalizeHost(
  host: string,
  namespace: string
): { namespace: string; service: string } {
  const parts = host.split('.');
  return { namespace: parts.length === 1 ? namespace : parts[1], service: parts[0] };
}

export function hostWithinWildcardHost(host: string, wildcard: string): boolean {
  return wildcard === '*' || (wildcard.startsWith('*.') && host.endsWith(wildcard.slice(1)));
}

export function parseGatewayAsHost(
  gateway: string,
  namespace: string,
  identityDomain: string
): IstioHost {
  const host = { service: gateway, namespace, identityDomain, completeInput: true };
  if (gateway.includes('.')) {
    const parts = gateway.split('.');
    host.service = parts[0];
    host.namespace = parts[1];
    if (parts.length > 2) host.identityDomain = parts.slice(2).join('.');
  } else if (gateway.includes('/')) {
    const parts = gateway.split('/');
    host.namespace = parts[0];
    host.service = parts[1];
  }
  return host;
}
