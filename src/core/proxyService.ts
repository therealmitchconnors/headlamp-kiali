import { validateIdentityDomain } from './config';
import { isDnsLabel } from './object';
import { proxyClusterSummary } from './proxySummary';

export interface ProxyServiceQuery {
  name: string | null;
  identityDomain: string | null;
}
export interface ProxyServiceTarget {
  namespace: string;
  name: string;
  port: number;
  subset: string;
}
export type ProxyServiceCandidate =
  | { available: true; target: ProxyServiceTarget }
  | { available: false; reason: 'domain' | 'format' | 'direction' | 'host' | 'port' };

export function proxyServiceCandidate(query: ProxyServiceQuery): ProxyServiceCandidate {
  if (!query.identityDomain) return { available: false, reason: 'domain' };
  const domain = validateIdentityDomain(query.identityDomain);
  if (query.name === null) return { available: false, reason: 'format' };
  if (typeof query.name !== 'string' || query.name.length > 4096)
    throw new Error('Envoy cluster name is malformed or exceeds 4096 characters');
  if (query.name.split('|').length !== 4) return { available: false, reason: 'format' };
  const summary = proxyClusterSummary({ name: query.name }, domain);
  if (summary.direction !== 'outbound') return { available: false, reason: 'direction' };
  if (
    !summary.host.completeInput ||
    summary.host.identityDomain !== domain ||
    !isDnsLabel(summary.host.namespace) ||
    !isDnsLabel(summary.host.service)
  )
    return { available: false, reason: 'host' };
  const port = BigInt(summary.port);
  if (port < BigInt(1) || port > BigInt(65535)) return { available: false, reason: 'port' };
  return {
    available: true,
    target: {
      namespace: summary.host.namespace,
      name: summary.host.service,
      port: Number(port),
      subset: summary.subset,
    },
  };
}
