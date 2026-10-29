import { isRecord } from './object';
import { assertProxyJson } from './proxyConfig';

function text(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > 4096)
    throw new Error(`Malformed or oversized ztunnel ${field}`);
  return value;
}
function strings(value: unknown, field: string): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > 100)
    throw new Error(`Malformed or oversized ztunnel ${field}`);
  return value.map(value => {
    const item = text(value, field);
    if (item === null) throw new Error(`Malformed ztunnel ${field}`);
    return item;
  });
}
function record(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Malformed ztunnel ${field}`);
  return value;
}
export interface ZtunnelWaypoint {
  destination: string | null;
  port: number | null;
}
function waypoint(value: unknown): ZtunnelWaypoint | null {
  if (value === undefined || value === null) return null;
  const item = record(value, 'waypoint');
  const port = item.hboneMtlsPort;
  if (
    port !== undefined &&
    port !== null &&
    (typeof port !== 'number' || !Number.isSafeInteger(port) || port < 0 || port > 65535)
  )
    throw new Error('Malformed ztunnel waypoint port');
  return {
    destination: text(item.destination, 'waypoint destination'),
    port: typeof port === 'number' ? port : null,
  };
}
export interface ZtunnelEndpoint {
  key: string;
  workloadUid: string | null;
  status: string | null;
}
export interface ZtunnelService {
  index: number;
  name: string | null;
  namespace: string | null;
  hostname: string | null;
  addresses: string[] | null;
  waypoint: ZtunnelWaypoint | null;
  endpoints: ZtunnelEndpoint[] | null;
  raw: Record<string, unknown>;
}
export interface ZtunnelWorkload {
  index: number;
  uid: string | null;
  name: string | null;
  namespace: string | null;
  clusterId: string | null;
  node: string | null;
  addresses: string[] | null;
  protocol: string | null;
  status: string | null;
  waypoint: ZtunnelWaypoint | null;
  raw: Record<string, unknown>;
}
export interface ZtunnelSnapshot {
  services: ZtunnelService[];
  workloads: ZtunnelWorkload[];
  runtime: {
    clusterId: string | null;
    clusterDomain: string | null;
    network: string | null;
    node: string | null;
  };
  certificateCount: number | null;
  policyCount: number | null;
}

export function ztunnelSnapshot(value: unknown): ZtunnelSnapshot {
  const dump = record(value, 'configuration dump');
  if (!Array.isArray(dump.services) || !Array.isArray(dump.workloads))
    throw new Error('The selected format requires ztunnel services and workloads arrays');
  if (dump.services.length > 1000 || dump.workloads.length > 1000)
    throw new Error('Ztunnel snapshots are limited to 1000 services and 1000 workloads');
  assertProxyJson(dump);
  function count(value: unknown, field: string): number | null {
    if (value === undefined || value === null) return null;
    if (!Array.isArray(value) || value.length > 1000)
      throw new Error(`Malformed or oversized ztunnel ${field}`);
    return value.length;
  }
  const config =
    dump.config === undefined || dump.config === null
      ? {}
      : record(dump.config, 'runtime configuration');
  let endpointCount = 0;
  const services = dump.services.map((value, index): ZtunnelService => {
    const service = record(value, 'service');
    let endpoints: ZtunnelEndpoint[] | null = null;
    if (service.endpoints !== undefined && service.endpoints !== null) {
      const source = record(service.endpoints, 'service endpoints');
      const entries = Object.entries(source);
      endpointCount += entries.length;
      if (entries.length > 1000 || endpointCount > 10000)
        throw new Error('Ztunnel endpoints exceed 1000 per service or 10000 per snapshot');
      endpoints = entries.map(([key, value]) => {
        if (key.length > 4096) throw new Error('Oversized ztunnel endpoint key');
        const endpoint = record(value, 'endpoint');
        return {
          key,
          workloadUid: text(endpoint.workloadUid, 'endpoint workload identity'),
          status: text(endpoint.status, 'endpoint status'),
        };
      });
    }
    return {
      index: index + 1,
      name: text(service.name, 'service name'),
      namespace: text(service.namespace, 'service namespace'),
      hostname: text(service.hostname, 'service hostname'),
      addresses: strings(service.vips, 'service VIPs'),
      waypoint: waypoint(service.waypoint),
      endpoints,
      raw: service,
    };
  });
  const workloads = dump.workloads.map((value, index): ZtunnelWorkload => {
    const workload = record(value, 'workload');
    return {
      index: index + 1,
      uid: text(workload.uid, 'workload identity'),
      name: text(workload.name, 'workload name'),
      namespace: text(workload.namespace, 'workload namespace'),
      clusterId: text(workload.clusterId, 'workload cluster'),
      node: text(workload.node, 'workload node'),
      addresses: strings(workload.workloadIps, 'workload addresses'),
      protocol: text(workload.protocol, 'workload protocol'),
      status: text(workload.status, 'workload status'),
      waypoint: waypoint(workload.waypoint),
      raw: workload,
    };
  });
  return {
    services,
    workloads,
    runtime: {
      clusterId: text(config.clusterId, 'cluster identity'),
      clusterDomain: text(config.clusterDomain, 'cluster domain'),
      network: text(config.network, 'network'),
      node: text(config.localNode, 'local node'),
    },
    certificateCount: count(dump.certificates, 'certificates'),
    policyCount: count(dump.policies, 'policies'),
  };
}
