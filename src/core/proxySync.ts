import { isDnsLabel, isDnsSubdomain, isRecord } from './object';

export interface ProxySyncResource {
  name: string;
  sent?: string;
  acked?: string;
  sentTime?: string;
  lastError?: string;
  state: 'synced' | 'stale' | 'not-reported';
}

export interface ProxySyncRecord {
  proxy: string;
  clusterId?: string;
  proxyType?: string;
  proxyVersion?: string;
  istioVersion?: string;
  resources: ProxySyncResource[];
}

const resourceFields = [
  ['CDS', 'cluster_sent', 'cluster_acked'],
  ['LDS', 'listener_sent', 'listener_acked'],
  ['RDS', 'route_sent', 'route_acked'],
  ['EDS', 'endpoint_sent', 'endpoint_acked'],
  ['ECDS', 'extensionconfig_sent', 'extensionconfig_acked'],
] as const;

function optionalText(value: unknown, field: string, maximum = 4096): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > maximum)
    throw new Error(`Malformed proxy sync ${field}`);
  return value;
}

function state(sent?: string, acked?: string): ProxySyncResource['state'] {
  if (!sent) return 'not-reported';
  return sent === acked ? 'synced' : 'stale';
}

export function proxySynczPath(namespace: string, pod: string, port: number): string {
  if (
    !isDnsLabel(namespace) ||
    !isDnsSubdomain(pod) ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error('A captured control-plane Pod and declared debug port are required');
  return `/api/v1/namespaces/${namespace}/pods/${pod}:${port}/proxy/debug/syncz`;
}

export function proxySyncSnapshot(value: unknown): ProxySyncRecord[] {
  if (!Array.isArray(value) || value.length > 1000)
    throw new Error('Proxy synchronization response is malformed or exceeds 1,000 records');
  const seen = new Set<string>();
  return value.map(entry => {
    if (!isRecord(entry)) throw new Error('Malformed proxy synchronization record');
    const proxy = optionalText(entry.proxy, 'proxy identity');
    if (!proxy?.trim()) throw new Error('Proxy synchronization record has no proxy identity');
    if (seen.has(proxy)) throw new Error('Proxy synchronization response has conflicting proxy identities');
    seen.add(proxy);
    const resources: ProxySyncResource[] = [];
    for (const [name, sentField, ackedField] of resourceFields) {
      const sent = optionalText(entry[sentField], `${name} sent version`);
      const acked = optionalText(entry[ackedField], `${name} acknowledged version`);
      if (sent !== undefined || acked !== undefined)
        resources.push({ name, sent, acked, state: state(sent, acked) });
    }
    if (entry.resources !== undefined && entry.resources !== null) {
      if (!isRecord(entry.resources) || Object.keys(entry.resources).length > 1000)
        throw new Error('Malformed or oversized proxy sync resources');
      for (const [name, raw] of Object.entries(entry.resources)) {
        if (!name || name.length > 256 || /[\u0000-\u001f\u007f]/.test(name) || !isRecord(raw))
          throw new Error('Malformed proxy sync resource identity');
        const sent = optionalText(raw.sent, `${name} sent version`);
        const acked = optionalText(raw.acked, `${name} acknowledged version`);
        const sentTime = optionalText(raw.sentTime, `${name} sent time`, 128);
        if (sentTime && !Number.isFinite(Date.parse(sentTime)))
          throw new Error(`Malformed proxy sync ${name} sent time`);
        const lastError = optionalText(raw.lastError, `${name} last error`);
        resources.push({
          name,
          sent,
          acked,
          sentTime,
          lastError,
          state: state(sent, acked),
        });
      }
    }
    if (resources.length > 2000) throw new Error('Proxy sync record has too many resources');
    return {
      proxy,
      clusterId: optionalText(entry.cluster_id, 'cluster identity', 1024),
      proxyType: optionalText(entry.proxy_type, 'proxy type', 128),
      proxyVersion: optionalText(entry.proxy_version, 'proxy version', 128),
      istioVersion: optionalText(entry.istio_version, 'Istio version', 128),
      resources,
    };
  });
}
