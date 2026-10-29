import { proxyConfiguration, proxyServerInfo } from './proxyConfig';

function section(type: string, fields: Record<string, unknown>) {
  return { '@type': `type.googleapis.com/envoy.admin.v3.${type}ConfigDump`, ...fields };
}
it('retains explicit active/warming/draining states, unknown fields and section types', () => {
  const listener = { name: 'inbound', address: { socket_address: { port_value: 9080 } } };
  const dynamic = {
    name: 'inbound',
    active_state: { listener, version_info: 'v1', last_updated: 'now' },
    warming_state: { listener },
    draining_state: { listener },
    error_state: { details: 'synthetic rejected update' },
  };
  const result = proxyConfiguration({
    configs: [
      section('Clusters', {
        static_clusters: [{ cluster: { name: 'static', unknown: false } }],
        dynamic_active_clusters: [{ cluster: { name: 'outbound|9080||reviews' } }],
        dynamic_warming_clusters: [{ cluster: { name: 'warming' } }],
      }),
      section('Routes', { dynamic_route_configs: [{ route_config: { name: '9080' } }] }),
      section('Listeners', { dynamic_listeners: [dynamic, { name: 'pending', error_state: {} }] }),
      section('Bootstrap', { bootstrap: { node: { id: 'synthetic' } } }),
    ],
  });
  expect(result.sections).toHaveLength(4);
  expect(result.entries).toHaveLength(8);
  expect(result.entries.map(entry => entry.state)).toEqual([
    'static',
    'active',
    'warming',
    'dynamic',
    'active',
    'warming',
    'draining',
    'unavailable',
  ]);
  expect(result.entries[4]).toMatchObject({ version: 'v1', updated: 'now', raw: dynamic });
  expect(result.entries[0].raw).toEqual({ cluster: { name: 'static', unknown: false } });
  expect(result.entries[7].version).toBeNull();
});
it.each([
  null,
  {},
  { configs: [null] },
  { configs: [{ '@type': '' }] },
  { configs: [section('Clusters', { static_clusters: {} })] },
  { configs: [section('Clusters', { static_clusters: [{}] })] },
  {
    configs: [
      section('Listeners', {
        dynamic_listeners: [{ name: 'a', active_state: { listener: { name: 'b' } } }],
      }),
    ],
  },
  { configs: [section('Clusters', {}), section('Clusters', {})] },
])('rejects malformed or ambiguous configuration %#', value => {
  expect(() => proxyConfiguration(value)).toThrow();
});
it('bounds nested data and keeps absent sections distinct from populated entries', () => {
  expect(proxyConfiguration({ configs: [] })).toEqual({ entries: [], sections: [] });
  let value: unknown = {};
  for (let i = 0; i < 65; i++) value = { nested: value };
  expect(() => proxyConfiguration({ configs: [section('Bootstrap', { value })] })).toThrow('bound');
  expect(() =>
    proxyConfiguration({ configs: [section('Bootstrap', { values: Array(10001).fill(0) })] })
  ).toThrow('10000');
});
it('preserves unnamed protobuf resources without inventing identities or discarding valid dumps', () => {
  const result = proxyConfiguration({
    configs: [
      section('Routes', {
        static_route_configs: [{ route_config: {} }, { route_config: { name: '' } }],
      }),
      section('Listeners', {
        dynamic_listeners: [{ name: 'wrapper-name', active_state: { listener: {} } }],
      }),
    ],
  });
  expect(result.entries.map(entry => entry.name)).toEqual([null, '', 'wrapper-name']);
});
it('reports server state without translating unknown fields to healthy defaults', () => {
  expect(proxyServerInfo({ version: '1.30', state: 'PRE_INITIALIZING' })).toEqual({
    version: '1.30',
    state: 'PRE_INITIALIZING',
    uptime: null,
    originalUptime: null,
  });
  expect(() => proxyServerInfo({ version: '1.30' })).toThrow('missing');
  expect(() => proxyServerInfo({ version: '1.30', state: 0 })).toThrow('Malformed');
});
it('retains repeated route names as separate indexed entries, not global resource identities', () => {
  const result = proxyConfiguration({
    configs: [
      section('Routes', {
        static_route_configs: [
          { route_config: { name: 'inbound', virtual_hosts: [{ name: 'a' }] } },
          { route_config: { name: 'inbound', virtual_hosts: [{ name: 'b' }] } },
        ],
      }),
    ],
  });
  expect(result.entries.map(entry => [entry.index, entry.name])).toEqual([
    [1, 'inbound'],
    [2, 'inbound'],
  ]);
  expect(result.entries[0].raw).not.toEqual(result.entries[1].raw);
});
