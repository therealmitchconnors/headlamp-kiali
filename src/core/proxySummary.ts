import { getHost, IstioHost, parseHost } from './hosts';
import { isRecord } from './object';

export interface EnvoyClusterSummaryInput {
  name: string;
  type?: string;
  metadata?: { filter_metadata?: { istio?: { config?: string } } };
}
export interface EnvoyClusterSummary {
  host: IstioHost;
  port: string;
  subset: string;
  direction: string;
  type: string;
  destinationRule: string;
}

/** Pinned Kiali xDS nonce comparison; callers must supply actual control-plane evidence. */
export function proxyXdsStatus(sent: string, acked: string, subscribed: boolean): string {
  if (!sent) return subscribed ? 'NOT_SENT' : 'IGNORED';
  if (sent === acked) return 'Synced';
  return acked ? 'Stale' : 'Stale (Never Acknowledged)';
}

export function proxyConfigReference(path: string): string {
  if (!path.startsWith('/apis/networking.istio.io/v1/namespaces/')) return '';
  const parts = path.split('/');
  return parts.length === 8 ? `${parts[7]}.${parts[5]}` : '';
}

export function readProxyMetadataPath(value: unknown): string {
  let current = value;
  for (const field of ['filter_metadata', 'istio', 'config']) {
    if (current === undefined || current === null) return '';
    if (!isRecord(current)) throw new Error('Malformed Envoy configuration metadata');
    current = current[field];
  }
  if (current === undefined) return '';
  if (typeof current !== 'string' || current.length > 4096)
    throw new Error('Malformed Envoy configuration metadata reference');
  return current;
}

export function readProxyMetadataReference(value: unknown): string {
  return proxyConfigReference(readProxyMetadataPath(value));
}

// strconv.Atoi's int64 result is carried as decimal text to avoid JS integer rounding.
function proxyPort(value: string): string {
  if (/^[+-]?[0-9]+$/.exec(value)?.[0] !== value) return '0';
  const number = BigInt(value);
  const maximum = BigInt('9223372036854775807');
  const minimum = -maximum - BigInt(1);
  return String(number > maximum ? maximum : number < minimum ? minimum : number);
}
const trimUnderscore = (value: string) => (value.endsWith('_') ? value.slice(0, -1) : value);

export function proxyClusterSummary(
  cluster: EnvoyClusterSummaryInput,
  identityDomain: string
): EnvoyClusterSummary {
  if (cluster.name.length > 4096) throw new Error('Proxy cluster name exceeds 4096 characters');
  const result: EnvoyClusterSummary = {
    host: { service: cluster.name, namespace: '', identityDomain: '', completeInput: false },
    port: '0',
    subset: '',
    direction: '',
    type: cluster.type ?? '',
    destinationRule: '',
  };
  const parts = cluster.name.split('|');
  if (parts.length > 3) {
    result.host = parseHost(parts[3], '', identityDomain);
    result.port = proxyPort(trimUnderscore(parts[1]));
    result.subset = parts[2];
    result.direction = trimUnderscore(parts[0]);
    result.destinationRule = proxyConfigReference(
      cluster.metadata?.filter_metadata?.istio?.config ?? ''
    );
  }
  return result;
}

export function readProxyClusterSummary(
  value: unknown,
  identityDomain: string
): EnvoyClusterSummary {
  if (!isRecord(value)) throw new Error('Malformed Envoy cluster');
  function string(value: unknown, field: string): string {
    if (value === undefined) return '';
    if (typeof value !== 'string' || value.length > 4096)
      throw new Error(`Malformed Envoy cluster ${field}`);
    return value;
  }
  const config = readProxyMetadataPath(value.metadata);
  return proxyClusterSummary(
    {
      name: string(value.name, 'name'),
      type: string(value.type, 'type'),
      metadata: { filter_metadata: { istio: { config } } },
    },
    identityDomain
  );
}

export function proxyApplicationProtocol(protocols: readonly string[]): string {
  const groups = [
    [
      'App: HTTP TLS',
      ['http/1.0', 'http/1.1', 'h2c', 'istio-http/1.0', 'istio-http/1.1', 'istio-h2'],
    ],
    ['App: Istio HTTP Plain', ['istio', 'istio-http/1.0', 'istio-http/1.1', 'istio-h2']],
    ['App: TCP TLS', ['istio-peer-exchange', 'istio']],
    ['App: HTTP', ['http/1.0', 'http/1.1', 'h2c']],
  ] as const;
  for (const [label, expected] of groups)
    if (
      expected.length === protocols.length &&
      expected.every((value, index) => value === protocols[index])
    )
      return label;
  return '';
}

export function proxyBestDomain(
  domains: readonly string[],
  namespaces: readonly string[],
  identityDomain: string
): IstioHost {
  if (!domains.length)
    return { service: '', namespace: '', identityDomain: '', completeInput: false };
  if (domains.length === 1) return getHost(domains[0], '', namespaces, identityDomain);
  const encoder = new TextEncoder();
  let best = domains[0];
  for (const domain of domains) {
    if (!domain || (domain[0] >= '1' && domain[0] <= '9')) continue;
    if (encoder.encode(best).length > encoder.encode(domain).length) best = domain;
  }
  return getHost(best, '', namespaces, identityDomain);
}
