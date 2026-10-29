import { TrafficEdge } from './telemetry';
import { buildTrafficGraph } from './trafficGraph';

const client = { cluster: 'east', namespace: 'bookinfo', workload: 'productpage' };
const server = { cluster: 'east', namespace: 'bookinfo', workload: 'reviews' };
const edge: TrafficEdge = { source: client, destination: server, protocol: 'http', rate: 3 };

it('preserves directed observed identity, de-duplicates nodes and aggregates rates', () => {
  const graph = buildTrafficGraph([
    edge,
    { ...edge, rate: 2 },
    { ...edge, source: server, destination: client },
  ]);
  expect(graph.nodes).toHaveLength(2);
  expect(graph.edges).toHaveLength(2);
  expect(
    graph.edges.find(item => item.source === JSON.stringify(['east', 'bookinfo', 'productpage']))
      ?.rate
  ).toBe(5);
});

it('never merges identical workload names across clusters or namespaces', () => {
  const graph = buildTrafficGraph([
    edge,
    { ...edge, source: { ...client, cluster: 'west' } },
    { ...edge, source: { ...client, namespace: 'other' } },
  ]);
  expect(graph.nodes).toHaveLength(4);
});

it('retains self-edges but never creates edges from zero or non-finite rates', () => {
  const graph = buildTrafficGraph([
    { ...edge, destination: client },
    { ...edge, rate: 0 },
    { ...edge, rate: NaN },
  ]);
  expect(graph.nodes).toHaveLength(1);
  expect(graph.edges).toHaveLength(1);
  expect(graph.edges[0].source).toBe(graph.edges[0].target);
});

it('is deterministic without mutating its input', () => {
  const data = [edge, { ...edge, source: server, destination: client }];
  const before = JSON.stringify(data);
  expect(buildTrafficGraph([...data].reverse())).toEqual(buildTrafficGraph(data));
  expect(JSON.stringify(data)).toBe(before);
});
