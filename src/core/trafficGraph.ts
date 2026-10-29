import { TrafficEdge } from './telemetry';

export interface TrafficNode {
  id: string;
  cluster: string;
  namespace: string;
  workload: string;
}

export interface TrafficGraphEdge {
  id: string;
  source: string;
  target: string;
  protocol: string;
  rate: number;
}
export interface TrafficGraphData {
  nodes: TrafficNode[];
  edges: TrafficGraphEdge[];
}

export interface TrafficDiagramData {
  nodes: { id: string; cluster: string; namespace: string; label: string; caption?: string }[];
  edges: TrafficGraphEdge[];
}

export function buildTrafficGraph(traffic: readonly TrafficEdge[]): TrafficGraphData {
  const nodes = new Map<string, TrafficNode>();
  const edges = new Map<string, TrafficGraphEdge>();
  for (const edge of traffic) {
    if (!Number.isFinite(edge.rate) || edge.rate <= 0) continue;
    const identity = (endpoint: TrafficEdge['source']) =>
      JSON.stringify([endpoint.cluster, endpoint.namespace, endpoint.workload]);
    const source = identity(edge.source);
    const target = identity(edge.destination);
    nodes.set(source, { ...edge.source, id: source });
    nodes.set(target, { ...edge.destination, id: target });
    const id = JSON.stringify([source, target, edge.protocol]);
    const previous = edges.get(id);
    const rate = (previous?.rate ?? 0) + edge.rate;
    if (!Number.isFinite(rate)) throw new Error('Aggregated traffic rate exceeded numeric limits');
    edges.set(id, {
      id,
      source,
      target,
      protocol: edge.protocol,
      rate,
    });
  }
  return {
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}
