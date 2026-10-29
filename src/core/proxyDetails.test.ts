import { proxyListenerDetails, proxyRouteDetails } from './proxyDetails';

it('retains all route actions, domains and complete match constraints', () => {
  const match = {
    prefix: '/',
    headers: [{ name: 'x-user', exact_match: 'test' }],
    query_parameters: [{ name: 'mode' }],
    future_match: false,
  };
  const result = proxyRouteDetails({
    virtual_hosts: [
      {
        name: 'reviews',
        domains: ['reviews', 'reviews.bookinfo'],
        routes: [
          {
            name: 'primary',
            match,
            route: {
              weighted_clusters: {
                clusters: [
                  { name: 'v1', weight: 0 },
                  { name: 'v2', weight: 100 },
                ],
              },
            },
            metadata: {
              filter_metadata: {
                istio: {
                  config:
                    '/apis/networking.istio.io/v1/namespaces/bookinfo/virtualservices/reviews',
                },
              },
            },
          },
          { match: { path: '/redirect' }, redirect: { https_redirect: true } },
          { direct_response: { status: 503 } },
          { route: { cluster: 'PassthroughCluster' } },
          { non_forwarding_action: {} },
        ],
      },
      { name: 'no-routes', domains: ['unserved'] },
    ],
  });
  expect(result.map(item => item.action)).toEqual([
    'forward',
    'redirect',
    'direct-response',
    'forward',
    'unsupported',
    'none',
  ]);
  expect(result[0]).toMatchObject({
    virtualHost: 'reviews',
    domains: ['reviews', 'reviews.bookinfo'],
    match,
    reference: 'reviews.bookinfo',
  });
  expect(result[0].actionData).toEqual({
    weighted_clusters: {
      clusters: [
        { name: 'v1', weight: 0 },
        { name: 'v2', weight: 100 },
      ],
    },
  });
  expect(result[3].actionData.cluster).toBe('PassthroughCluster');
});
it('retains default chains, unknown match fields, protocol ordering and all recognized destinations', () => {
  const match = {
    application_protocols: ['istio-peer-exchange', 'istio'],
    server_names: ['*.example'],
    destination_port: 9080,
    future_match: { enabled: false },
  };
  const result = proxyListenerDetails({
    address: { socket_address: { address: '0.0.0.0', port_value: 15006 } },
    filter_chains: [
      {
        name: 'tls',
        filter_chain_match: match,
        filters: [
          {
            name: 'envoy.filters.network.http_connection_manager',
            typed_config: { rds: { route_config_name: '9080' } },
          },
          {
            name: 'envoy.filters.network.tcp_proxy',
            typed_config: { weighted_clusters: { clusters: [{ name: 'a', weight: 100 }] } },
          },
          { name: 'vendor.unknown', typed_config: { unknown: true } },
        ],
      },
    ],
    default_filter_chain: {
      filters: [
        {
          name: 'envoy.filters.network.tcp_proxy',
          typed_config: { cluster: 'PassthroughCluster' },
        },
      ],
    },
  });
  expect(result.address).toEqual({ socket_address: { address: '0.0.0.0', port_value: 15006 } });
  expect(result.entries[0]).toMatchObject({
    defaultChain: false,
    match,
    applicationProtocol: 'App: TCP TLS',
    filterNames: [
      'envoy.filters.network.http_connection_manager',
      'envoy.filters.network.tcp_proxy',
      'vendor.unknown',
    ],
  });
  expect(result.entries[0].destinations.map(item => item.kind)).toEqual(['route', 'weighted']);
  expect(result.entries[1]).toMatchObject({
    defaultChain: true,
    destinations: [{ kind: 'cluster', value: 'PassthroughCluster' }],
  });
});
it('retains inline route configuration and does not invent destinations', () => {
  const inline = {
    virtual_hosts: [
      { domains: ['*'], routes: [{ match: { prefix: '/' }, route: { cluster: 'a' } }] },
    ],
  };
  const result = proxyListenerDetails({
    filter_chains: [
      {
        filters: [
          {
            name: 'envoy.filters.network.http_connection_manager',
            typed_config: { route_config: inline },
          },
          { name: 'envoy.filters.network.tcp_proxy' },
        ],
      },
    ],
  });
  expect(result.entries[0].destinations.map(item => [item.kind, item.value])).toEqual([
    ['inline', inline],
    ['unknown', null],
  ]);
  expect(result.entries[0].applicationProtocol).toBe('');
  expect(proxyListenerDetails({})).toEqual({ address: {}, entries: [] });
  expect(proxyRouteDetails({})).toEqual([]);
});
it.each([
  undefined,
  null,
  [],
  { virtual_hosts: {} },
  { virtual_hosts: [null] },
  { virtual_hosts: [{ domains: [7] }] },
  { virtual_hosts: [{ routes: [{ route: {}, redirect: {} }] }] },
  { virtual_hosts: [{ routes: [{ route: {}, match: false }] }] },
])('rejects malformed or ambiguous route summaries %#', value => {
  expect(() => proxyRouteDetails(value)).toThrow();
});
it.each([
  undefined,
  null,
  [],
  { address: [] },
  { filter_chains: [null] },
  {
    filter_chains: [
      {
        filters: [
          {
            name: 'envoy.filters.network.http_connection_manager',
            typed_config: { route_config: {}, rds: {} },
          },
        ],
      },
    ],
  },
  {
    filter_chains: [
      {
        filters: [
          {
            name: 'envoy.filters.network.tcp_proxy',
            typed_config: { cluster: 'a', weighted_clusters: {} },
          },
        ],
      },
    ],
  },
])('rejects malformed or ambiguous listener summaries %#', value => {
  expect(() => proxyListenerDetails(value)).toThrow();
});
it('enforces combined route, chain and network-filter bounds', () => {
  expect(() => proxyRouteDetails({ virtual_hosts: Array(1001).fill({}) })).toThrow('oversized');
  expect(() =>
    proxyRouteDetails({ virtual_hosts: [{ routes: Array(1000).fill({}) }, {}] })
  ).toThrow('1000');
  expect(() =>
    proxyListenerDetails({ filter_chains: Array(1000).fill({}), default_filter_chain: {} })
  ).toThrow('1000');
  expect(() =>
    proxyListenerDetails({
      filter_chains: Array(11).fill({ filters: Array(1000).fill({ name: 'test' }) }),
    })
  ).toThrow('10000');
});
