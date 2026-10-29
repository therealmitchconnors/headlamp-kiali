import { isRecord } from './object';

export interface ProxyConfigEntry {
  index: number;
  kind: 'cluster' | 'route' | 'listener';
  name: string | null;
  state: 'static' | 'active' | 'warming' | 'draining' | 'dynamic' | 'unavailable';
  version: string | null;
  updated: string | null;
  resource: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export function assertProxyJson(value: unknown) {
  const pending = [{ value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++count > 100000 || item.depth > 64)
      throw new Error('Proxy JSON exceeds the 100000-value or 64-level bound');
    if (item.value && typeof item.value === 'object') {
      const children = Object.values(item.value);
      if (children.length > 10000) throw new Error('Proxy JSON collection exceeds 10000 values');
      for (const value of children) pending.push({ value, depth: item.depth + 1 });
    } else if (typeof item.value === 'number' && !Number.isFinite(item.value)) {
      throw new Error('Proxy JSON contains a non-finite value');
    }
  }
}

function text(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length > 4096)
    throw new Error('Malformed or oversized proxy text field');
  return value;
}

export function proxyServerInfo(value: unknown) {
  if (!isRecord(value)) throw new Error('Malformed proxy server information');
  assertProxyJson(value);
  const result = {
    version: text(value.version),
    state: text(value.state),
    uptime: text(value.uptime_current_epoch),
    originalUptime: text(value.uptime_all_epochs),
  };
  if (!result.version || !result.state)
    throw new Error('Proxy server information is missing version or state');
  return result;
}

export function proxyConfiguration(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.configs) || value.configs.length > 64)
    throw new Error('Malformed or oversized Envoy configuration dump');
  assertProxyJson(value);
  const entries: ProxyConfigEntry[] = [];
  const sections: string[] = [];
  const prefix = 'type.googleapis.com/envoy.admin.v3.';
  function add(
    kind: ProxyConfigEntry['kind'],
    state: ProxyConfigEntry['state'],
    wrapper: unknown,
    resourceKey: string,
    fallbackName?: string | null
  ) {
    if (!isRecord(wrapper) || !isRecord(wrapper[resourceKey]))
      throw new Error('Malformed proxy configuration resource');
    const resource = wrapper[resourceKey];
    const name = text(resource.name) ?? fallbackName ?? null;
    if (entries.length >= 10000) throw new Error('Proxy configuration exceeds 10000 entries');
    entries.push({
      index: entries.length + 1,
      kind,
      state,
      name,
      version: text(wrapper.version_info),
      updated: text(wrapper.last_updated),
      resource,
      raw: wrapper,
    });
  }
  for (const section of value.configs) {
    if (!isRecord(section) || typeof section['@type'] !== 'string' || !section['@type'])
      throw new Error('Proxy configuration section has no type');
    const type = section['@type'];
    if (type.length > 1024 || sections.includes(type))
      throw new Error('Oversized or duplicate proxy configuration type');
    sections.push(type);
    function list(field: string): unknown[] {
      if (section[field] === undefined) return [];
      if (!Array.isArray(section[field])) throw new Error('Malformed proxy configuration list');
      return section[field];
    }
    if (type === `${prefix}ClustersConfigDump`) {
      for (const [field, state] of [
        ['static_clusters', 'static'],
        ['dynamic_active_clusters', 'active'],
        ['dynamic_warming_clusters', 'warming'],
      ] as const)
        list(field).forEach(item => add('cluster', state, item, 'cluster'));
    } else if (type === `${prefix}RoutesConfigDump`) {
      list('static_route_configs').forEach(item => add('route', 'static', item, 'route_config'));
      list('dynamic_route_configs').forEach(item => add('route', 'dynamic', item, 'route_config'));
    } else if (type === `${prefix}ListenersConfigDump`) {
      list('static_listeners').forEach(item => add('listener', 'static', item, 'listener'));
      for (const item of list('dynamic_listeners')) {
        if (!isRecord(item)) throw new Error('Malformed dynamic proxy listener');
        const name = text(item.name);
        let found = false;
        for (const [field, state] of [
          ['active_state', 'active'],
          ['warming_state', 'warming'],
          ['draining_state', 'draining'],
        ] as const) {
          if (item[field] === undefined) continue;
          add('listener', state, item[field], 'listener', name);
          const entry = entries[entries.length - 1];
          if (entry.name && name && entry.name !== name)
            throw new Error('Proxy listener identity is inconsistent');
          entry.raw = item;
          found = true;
        }
        if (!found) {
          add('listener', 'unavailable', { listener: { name: item.name } }, 'listener');
          entries[entries.length - 1].raw = item;
        }
      }
    }
  }
  return { entries, sections };
}
