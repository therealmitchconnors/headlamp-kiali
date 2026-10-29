import oracleText from '../../test-files/parity/topology-oracle.json?raw';
import fixtureText from '../../test-files/topology/fixture.json?raw';
import { MetricResult } from './telemetry';
import {
  decodeTopology,
  filterTopology,
  projectTopology,
  TopologyEndpoint,
  topologyIdentity,
  TopologyMode,
  topologyNamespacePosition,
  topologyQueries,
  TopologyQuery,
  topologyUnit,
} from './topology';

const query: TopologyQuery = {
  namespace: 'bookinfo',
  telemetryCluster: 'Kubernetes',
  reporter: 'source',
  windowSeconds: 600,
  end: 10000,
  measure: 'requests',
  includeIdle: false,
};
const fixture = JSON.parse(fixtureText);
const result = (): MetricResult => ({
  warnings: [],
  series: fixture.samples.map((item: { labels: Record<string, string>; rate: number }) => ({
    labels: { ...fixture.labels, ...item.labels },
    samples: [{ timestamp: query.end, value: item.rate }],
  })),
});
const decode = (value = result(), request = query) =>
  decodeTopology([{ metric: 'istio_requests_total', result: value }], request);
const oracle: {
  cases: {
    input: { mode: TopologyMode; endpoint: TopologyEndpoint };
    expected: { id: string; kind: string; error: boolean };
  }[];
} = JSON.parse(oracleText);
it.each(oracle.cases)('matches original Go identity $input / $expected', ({ input, expected }) => {
  if (expected.error) expect(() => topologyIdentity(input.endpoint, input.mode)).toThrow();
  else {
    const actual = topologyIdentity(input.endpoint, input.mode);
    expect(actual.parts.join('_')).toBe(expected.id);
    expect(actual.kind).toBe(expected.kind);
  }
});
it.each(['workload', 'app', 'service'] as const)(
  'compares %s namespace names without inferring access or cluster membership',
  kind => {
    expect(topologyNamespacePosition({ kind, namespace: 'bookinfo' }, 'bookinfo')).toBe('selected');
    expect(topologyNamespacePosition({ kind, namespace: 'edge' }, 'bookinfo')).toBe('outside');
    expect(topologyNamespacePosition({ kind, namespace: 'unknown' }, 'bookinfo')).toBe('unknown');
    expect(topologyNamespacePosition({ kind, namespace: '' }, 'bookinfo')).toBe('unknown');
  }
);
it('retains unknown-node provenance and rejects an invalid graph selection', () => {
  expect(topologyNamespacePosition({ kind: 'unknown', namespace: 'bookinfo' }, 'bookinfo')).toBe(
    'unknown'
  );
  for (const namespace of ['', 'bookinfo\n', '*', 'a'.repeat(64)])
    expect(() =>
      topologyNamespacePosition({ kind: 'workload', namespace: 'bookinfo' }, namespace)
    ).toThrow('explicit namespace');
});
it('keeps tuple identities collision-free when upstream delimiter IDs collide', () => {
  const endpoint = oracle.cases.find(item => item.input.endpoint.workload === 'reviews-v1')!.input
    .endpoint;
  const a = topologyIdentity({ ...endpoint, cluster: 'east_west', namespace: 'ns' }, 'workload');
  const b = topologyIdentity({ ...endpoint, cluster: 'east', namespace: 'west_ns' }, 'workload');
  expect(a.parts.join('_')).toBe(b.parts.join('_'));
  expect(a.id).not.toBe(b.id);
});
it.each([
  ['requests', ['istio_requests_total'], 'requests'],
  ['tcpSent', ['istio_tcp_sent_bytes_total'], 'bytes'],
  ['tcpReceived', ['istio_tcp_received_bytes_total'], 'bytes'],
  ['tcpTotal', ['istio_tcp_sent_bytes_total', 'istio_tcp_received_bytes_total'], 'bytes'],
  ['grpcSent', ['istio_request_messages_total'], 'messages'],
  ['grpcReceived', ['istio_response_messages_total'], 'messages'],
  ['grpcTotal', ['istio_request_messages_total', 'istio_response_messages_total'], 'messages'],
] as const)('builds scoped %s selectors without mixing units', (measure, expected, unit) => {
  const expressions = topologyQueries({ ...query, measure, telemetryCluster: 'east"\\\nwest' });
  expect(expressions.map(item => item.metric)).toEqual(expected);
  expect(topologyUnit(measure)).toBe(unit);
  for (const item of expressions) {
    expect(item.query.match(/rate\(/g)?.length).toBe(3);
    expect(item.query.match(/\[600s\]/g)?.length).toBe(3);
    expect(item.query).toContain(`source_cluster=${JSON.stringify('east"\\\nwest')}`);
    expect(item.query).toContain('destination_service_namespace="bookinfo"');
    expect(item.query.match(/reporter="source"/g)?.length).toBe(3);
    expect(item.query).not.toContain('source_app');
  }
});
it.each([
  { namespace: '../ns' },
  { namespace: 'bookinfo\n' },
  { telemetryCluster: ' ' },
  { end: NaN },
  { end: 0 },
  { end: 1.5 },
  { end: 8640000000001 },
  { windowSeconds: 0 },
  { measure: '__proto__' },
  { reporter: 'both' },
  { includeIdle: 'true' },
])('rejects invalid topology requests %j', patch => {
  expect(() => topologyQueries({ ...query, ...patch } as TopologyQuery)).toThrow();
});
it('projects workload, canonical-app, versioned-app and inferred service adjacency', () => {
  const data = decode();
  expect(data.warnings).toEqual([]);
  expect(projectTopology(data, 'workload').nodes).toHaveLength(6);
  expect(projectTopology(data, 'app').nodes).toHaveLength(4);
  expect(projectTopology(data, 'versionedApp').nodes).toHaveLength(6);
  const graph = projectTopology(data, 'service');
  expect(graph.nodes.map(node => node.label).sort()).toEqual([
    'gateway',
    'productpage',
    'ratings',
    'reviews',
  ]);
  const edge = graph.edges.find(
    edge => graph.nodes.find(node => node.id === edge.source)?.label === 'reviews'
  )!;
  expect(edge.rate).toBe(5);
  expect(edge.inferred).toBe(true);
  expect(edge.responses).toEqual({ '200': 2, '503': 3 });
  expect(edge.security).toEqual({ mutual_tls: 2, none: 3 });
  expect(graph.warnings).toContainEqual({ code: 'service-projection' });
  expect(filterTopology(graph, 'ratings').edges).toHaveLength(1);
  expect(filterTopology(graph, 'missing').nodes).toHaveLength(0);
});
it('does not split one workload into spurious versioned nodes or invent a source service label', () => {
  const data = result();
  data.series[1].labels.destination_workload = 'reviews-v1';
  const graph = projectTopology(decode(data), 'versionedApp');
  const node = graph.nodes.find(node => node.workloads.includes('reviews-v1'))!;
  expect(node.versions).toEqual(['v1', 'v2']);
  expect(graph.warnings).toContainEqual({ code: 'conflicting-revisions' });
  const service = projectTopology(decode(), 'service');
  expect(service.nodes.find(node => node.label === 'gateway')?.kind).toBe('workload');
});
it('retains aliases as explicit inferred observations instead of claiming additive source service rates', () => {
  const data = result();
  data.series.push({
    ...data.series[0],
    labels: {
      ...data.series[0].labels,
      destination_workload: 'reviews-v2',
      destination_service_name: 'reviews-alias',
      destination_service: 'reviews-alias.bookinfo.svc.cluster.local',
    },
  });
  const graph = projectTopology(decode(data), 'service');
  expect(graph.warnings).toContainEqual({ code: 'service-aliases' });
  expect(
    graph.edges.find(
      edge => graph.nodes.find(node => node.id === edge.source)?.label === 'reviews-alias'
    )?.rate
  ).toBe(2);
});
it('omits unsupported direct workload paths in a service projection without fabricating Services', () => {
  const data = result();
  data.series = data.series.slice(0, 1);
  data.series[0].labels.destination_service_name = 'unknown';
  const graph = projectTopology(decode(data), 'service');
  expect(graph.nodes).toEqual([]);
  expect(graph.edges).toEqual([]);
  expect(graph.warnings).toContainEqual({ code: 'omitted-paths', count: 1 });
});
it('retains unknown metadata and explicit idle rates only when requested', () => {
  const data = result();
  data.series = data.series.slice(0, 1);
  data.series[0].samples[0].value = 0;
  delete data.series[0].labels.source_canonical_service;
  expect(decode(data).observations).toHaveLength(0);
  const decoded = decode(data, { ...query, includeIdle: true });
  expect(decoded.warnings).toContainEqual({
    code: 'missing-label',
    label: 'source_canonical_service',
  });
  expect(projectTopology(decoded, 'app').edges[0].rate).toBe(0);
});
it.each([
  'reporter',
  'scope',
  'duplicate',
  'negative',
  'nonfinite',
  'missing',
  'stale',
  'timestamp',
  'protocol',
  'labels',
])('rejects %s observations instead of returning an empty healthy graph', invalid => {
  const data = result();
  if (invalid === 'reporter') data.series[0].labels.reporter = 'destination';
  if (invalid === 'scope') {
    data.series[0].labels.source_cluster = 'wrong';
    data.series[0].labels.destination_cluster = 'wrong';
  }
  if (invalid === 'duplicate') data.series.push(data.series[0]);
  if (invalid === 'negative') data.series[0].samples[0].value = -1;
  if (invalid === 'nonfinite') data.series[0].samples[0].value = Infinity;
  if (invalid === 'missing') data.series[0].samples[0].value = null;
  if (invalid === 'stale') data.series[0].samples[0].timestamp -= 2;
  if (invalid === 'timestamp') data.series[0].samples[0].timestamp = NaN;
  if (invalid === 'protocol') delete data.series[0].labels.request_protocol;
  if (invalid === 'labels') data.series[0].labels.response_flags = 'x'.repeat(4097);
  expect(() => decode(data)).toThrow();
});
it('requires both total counters, rejects protocol conflicts and preserves reported warning text', () => {
  const data = result();
  data.series = data.series.slice(0, 1);
  data.series[0].labels.request_protocol = 'tcp';
  data.warnings = ['partial backend result'];
  const request = { ...query, measure: 'tcpTotal' as const };
  const reads = topologyQueries(request).map(item => ({ metric: item.metric, result: data }));
  expect(() => decodeTopology(reads.slice(0, 1), request)).toThrow();
  const decoded = decodeTopology(reads, request);
  expect(projectTopology(decoded, 'workload').edges[0].rate).toBe(2);
  expect(decoded.warnings).toEqual([{ code: 'prometheus', message: 'partial backend result' }]);
  data.series[0].labels.request_protocol = 'http';
  expect(() => decodeTopology(reads, request)).toThrow(/conflicts/);
});
it('rejects unexpected dimensions instead of double-counting supposedly aggregated observations', () => {
  const data = result();
  data.series.push({
    ...data.series[0],
    labels: { ...data.series[0].labels, pod: 'extra-dimension' },
  });
  expect(() => decode(data)).toThrow(/outside the requested aggregation/);
});
it('bounds nodes, observations, filters and overflowing aggregated rates', () => {
  const sample = decode().observations[0];
  const observations = Array.from({ length: 1001 }, (_, index) => ({
    ...sample,
    source: { ...sample.source, workload: `w-${index}` },
  }));
  expect(() => projectTopology({ observations, warnings: [] }, 'workload')).toThrow(/1000/);
  expect(() =>
    projectTopology({ observations: Array(4001).fill(sample), warnings: [] }, 'app')
  ).toThrow(/4000/);
  expect(() =>
    projectTopology(
      {
        observations: [
          { ...sample, rate: Number.MAX_VALUE },
          { ...sample, rate: Number.MAX_VALUE },
        ],
        warnings: [],
      },
      'app'
    )
  ).toThrow(/numeric/);
  expect(() => filterTopology(projectTopology(decode(), 'workload'), 'a'.repeat(257))).toThrow();
});

it('accepts the exact node/edge budgets and rejects the next distinct identity', () => {
  const sample = decode().observations[0];
  const nodes = Array.from({ length: 999 }, (_, index) => ({
    ...sample,
    source: { ...sample.source, workload: `w-${index}` },
  }));
  expect(projectTopology({ observations: nodes, warnings: [] }, 'workload').nodes).toHaveLength(
    1000
  );
  const edges = Array.from({ length: 2000 }, (_, index) => ({
    ...sample,
    source: { ...sample.source, workload: `s-${index % 20}` },
    destination: { ...sample.destination, workload: `d-${Math.floor(index / 20)}` },
  }));
  expect(projectTopology({ observations: edges, warnings: [] }, 'workload').edges).toHaveLength(
    2000
  );
  expect(() =>
    projectTopology(
      { observations: [...edges, { ...edges[0], protocol: 'grpc' }], warnings: [] },
      'workload'
    )
  ).toThrow(/2000/);
});

it('bounds Service alias expansion by contributions rather than only final edge count', () => {
  const sample = decode().observations[0];
  const parents = Array.from({ length: 20 }, (_, index) => ({
    ...sample,
    destination: { ...sample.destination, service: `alias-${index}` },
  }));
  const child = {
    ...sample,
    source: { ...sample.destination, service: '' },
    destination: {
      ...sample.destination,
      workload: 'ratings-v1',
      app: 'ratings',
      service: 'ratings',
    },
  };
  const children = Array.from({ length: 999 }, (_, index) => ({ ...child, code: `code-${index}` }));
  expect(
    projectTopology({ observations: [...parents, ...children], warnings: [] }, 'service').edges
  ).toHaveLength(40);
  expect(() =>
    projectTopology({ observations: [...parents, ...children, child], warnings: [] }, 'service')
  ).toThrow(/20000/);
});
