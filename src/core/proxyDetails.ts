import { isRecord } from './object';
import {
  proxyApplicationProtocol,
  proxyConfigReference,
  readProxyMetadataPath,
} from './proxySummary';

function object(value: unknown, field: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error(`Malformed Envoy ${field}`);
  return value;
}
function array(value: unknown, field: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 1000)
    throw new Error(`Malformed or oversized Envoy ${field}`);
  return value;
}
function text(value: unknown, field: string): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > 4096) throw new Error(`Malformed Envoy ${field}`);
  return value;
}
function strings(value: unknown, field: string): string[] {
  return array(value, field).map(value => text(value, field));
}
export interface ProxyRouteDetail {
  index: number;
  virtualHost: string;
  domains: string[];
  name: string;
  match: Record<string, unknown>;
  action: 'forward' | 'redirect' | 'direct-response' | 'none' | 'unsupported';
  actionData: Record<string, unknown>;
  reference: string;
  referencePath: string;
}

/** Preserve every route action and match field, not just Kiali's path-only summary. */
export function proxyRouteDetails(value: unknown): ProxyRouteDetail[] {
  if (!isRecord(value)) throw new Error('Malformed Envoy route configuration');
  const config = object(value, 'route configuration');
  const result: ProxyRouteDetail[] = [];
  for (const rawHost of array(config.virtual_hosts, 'virtual hosts')) {
    const host = object(rawHost, 'virtual host');
    const virtualHost = text(host.name, 'virtual host name');
    const domains = strings(host.domains, 'route domains');
    const routes = array(host.routes, 'virtual host routes');
    if (!routes.length) {
      result.push({
        index: result.length + 1,
        virtualHost,
        domains,
        name: '',
        match: {},
        action: 'none',
        actionData: {},
        reference: '',
        referencePath: '',
      });
    }
    for (const rawRoute of routes) {
      if (result.length >= 1000) throw new Error('Envoy route summary exceeds 1000 entries');
      const route = object(rawRoute, 'route');
      const actions = [
        ['route', 'forward'],
        ['redirect', 'redirect'],
        ['direct_response', 'direct-response'],
        ['filter_action', 'unsupported'],
        ['non_forwarding_action', 'unsupported'],
      ] as const;
      const selected = actions.filter(([field]) => route[field] !== undefined);
      if (selected.length > 1) throw new Error('Ambiguous Envoy route actions');
      const action = selected[0];
      const referencePath = readProxyMetadataPath(route.metadata);
      result.push({
        index: result.length + 1,
        virtualHost,
        domains,
        name: text(route.name, 'route name'),
        match: object(route.match, 'route match'),
        action: action ? action[1] : 'none',
        actionData: action ? object(route[action[0]], 'route action') : {},
        reference: proxyConfigReference(referencePath),
        referencePath,
      });
    }
    if (result.length > 1000) throw new Error('Envoy route summary exceeds 1000 entries');
  }
  return result;
}

export interface ProxyListenerDetail {
  index: number;
  defaultChain: boolean;
  name: string;
  match: Record<string, unknown>;
  applicationProtocol: string;
  filterNames: string[];
  destinations: {
    filter: string;
    kind: 'route' | 'inline' | 'cluster' | 'weighted' | 'unknown';
    value: unknown;
  }[];
}
export function proxyListenerDetails(value: unknown) {
  if (!isRecord(value)) throw new Error('Malformed Envoy listener');
  const listener = object(value, 'listener');
  const chains = array(listener.filter_chains, 'filter chains').map(chain => ({
    chain,
    defaultChain: false,
  }));
  if (listener.default_filter_chain !== undefined)
    chains.push({ chain: listener.default_filter_chain, defaultChain: true });
  if (chains.length > 1000) throw new Error('Envoy listener summary exceeds 1000 filter chains');
  let filterCount = 0;
  const entries: ProxyListenerDetail[] = chains.map(({ chain: rawChain, defaultChain }, i) => {
    const chain = object(rawChain, 'filter chain');
    const match = object(chain.filter_chain_match, 'filter chain match');
    const protocols = strings(match.application_protocols, 'application protocols');
    const filters = array(chain.filters, 'network filters').map(value =>
      object(value, 'network filter')
    );
    filterCount += filters.length;
    if (filterCount > 10000)
      throw new Error('Envoy listener summary exceeds 10000 network filters');
    const filterNames = filters.map(filter => text(filter.name, 'network filter name'));
    const destinations: ProxyListenerDetail['destinations'] = [];
    filters.forEach((filter, index) => {
      const name = filterNames[index];
      const config = object(filter.typed_config, 'network filter configuration');
      if (name === 'envoy.filters.network.http_connection_manager') {
        if (config.route_config !== undefined && config.rds !== undefined)
          throw new Error('Ambiguous Envoy HTTP route sources');
        if (config.route_config !== undefined) {
          destinations.push({
            filter: name,
            kind: 'inline',
            value: object(config.route_config, 'inline route configuration'),
          });
        } else if (config.rds !== undefined) {
          const rds = object(config.rds, 'route discovery configuration');
          destinations.push({
            filter: name,
            kind: 'route',
            value: text(rds.route_config_name, 'route discovery name'),
          });
        } else destinations.push({ filter: name, kind: 'unknown', value: null });
      } else if (name === 'envoy.filters.network.tcp_proxy') {
        if (config.cluster !== undefined && config.weighted_clusters !== undefined)
          throw new Error('Ambiguous Envoy TCP cluster sources');
        if (config.cluster !== undefined)
          destinations.push({
            filter: name,
            kind: 'cluster',
            value: text(config.cluster, 'TCP cluster'),
          });
        else if (config.weighted_clusters !== undefined)
          destinations.push({
            filter: name,
            kind: 'weighted',
            value: object(config.weighted_clusters, 'weighted clusters'),
          });
        else destinations.push({ filter: name, kind: 'unknown', value: null });
      }
    });
    return {
      index: i + 1,
      defaultChain,
      name: text(chain.name, 'filter chain name'),
      match,
      applicationProtocol: proxyApplicationProtocol(protocols),
      filterNames,
      destinations,
    };
  });
  return { address: object(listener.address, 'listener address'), entries };
}
