import { isDnsLabel, isDnsSubdomain } from './object';

export type ProxyConfigurationKind = 'DestinationRule' | 'VirtualService';
export interface ProxyConfigurationQuery {
  kind: ProxyConfigurationKind;
  path: string;
}
export type ProxyConfigurationTarget =
  | {
      available: true;
      kind: ProxyConfigurationKind;
      namespace: string;
      name: string;
      observedApiVersion: string;
    }
  | { available: false; reason: 'absent' | 'format' | 'kind' | 'identity' };

export function proxyConfigurationTarget(query: ProxyConfigurationQuery): ProxyConfigurationTarget {
  if (query.kind !== 'DestinationRule' && query.kind !== 'VirtualService')
    throw new Error('Unsupported proxy configuration reference kind');
  if (typeof query.path !== 'string' || query.path.length > 4096)
    throw new Error('Proxy configuration reference is malformed or exceeds 4096 characters');
  if (!query.path) return { available: false, reason: 'absent' };
  const parts = query.path.split('/');
  if (
    parts.length !== 8 ||
    parts[0] !== '' ||
    parts[1] !== 'apis' ||
    parts[2] !== 'networking.istio.io' ||
    parts[3] !== 'v1' ||
    parts[4] !== 'namespaces'
  )
    return { available: false, reason: 'format' };
  if (parts[6] !== (query.kind === 'DestinationRule' ? 'destinationrules' : 'virtualservices'))
    return { available: false, reason: 'kind' };
  if (!isDnsLabel(parts[5]) || !isDnsSubdomain(parts[7]))
    return { available: false, reason: 'identity' };
  return {
    available: true,
    kind: query.kind,
    namespace: parts[5],
    name: parts[7],
    observedApiVersion: 'networking.istio.io/v1',
  };
}
