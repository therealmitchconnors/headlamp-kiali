import { requestHealthCode } from './healthReporters';
import { isDnsLabel } from './object';
import { MetricResult, metricSelector } from './telemetry';

export type TopologyMode = 'workload' | 'app' | 'versionedApp' | 'service';
export type TopologyMeasure =
  | 'requests'
  | 'tcpSent'
  | 'tcpReceived'
  | 'tcpTotal'
  | 'grpcSent'
  | 'grpcReceived'
  | 'grpcTotal';
export interface TopologyQuery {
  namespace: string;
  telemetryCluster: string;
  reporter: 'source' | 'destination';
  windowSeconds: 60 | 300 | 600 | 900 | 3600;
  end: number;
  measure: TopologyMeasure;
  includeIdle: boolean;
}
const METRICS: Record<TopologyMeasure, readonly string[]> = {
  requests: ['istio_requests_total'],
  tcpSent: ['istio_tcp_sent_bytes_total'],
  tcpReceived: ['istio_tcp_received_bytes_total'],
  tcpTotal: ['istio_tcp_sent_bytes_total', 'istio_tcp_received_bytes_total'],
  grpcSent: ['istio_request_messages_total'],
  grpcReceived: ['istio_response_messages_total'],
  grpcTotal: ['istio_request_messages_total', 'istio_response_messages_total'],
};
const LABELS = [
  'reporter',
  'source_cluster',
  'source_workload_namespace',
  'source_workload',
  'source_canonical_service',
  'source_canonical_revision',
  'destination_cluster',
  'destination_service_namespace',
  'destination_service',
  'destination_service_name',
  'destination_workload_namespace',
  'destination_workload',
  'destination_canonical_service',
  'destination_canonical_revision',
  'request_protocol',
  'response_code',
  'grpc_response_status',
  'response_flags',
  'connection_security_policy',
];
export function topologyQueries(query: TopologyQuery): { metric: string; query: string }[] {
  if (
    !isDnsLabel(query.namespace) ||
    query.namespace.trim() !== query.namespace ||
    !query.telemetryCluster.trim() ||
    query.telemetryCluster.length > 256 ||
    !['source', 'destination'].includes(query.reporter) ||
    ![60, 300, 600, 900, 3600].includes(query.windowSeconds) ||
    !Number.isSafeInteger(query.end) ||
    query.end <= 0 ||
    query.end > 8640000000000 ||
    !Object.prototype.hasOwnProperty.call(METRICS, query.measure) ||
    typeof query.includeIdle !== 'boolean'
  )
    throw new Error('Invalid topology scope, reporter, measure or captured time');
  const scopes = [
    { source_cluster: query.telemetryCluster, source_workload_namespace: query.namespace },
    {
      destination_cluster: query.telemetryCluster,
      destination_workload_namespace: query.namespace,
    },
    { destination_cluster: query.telemetryCluster, destination_service_namespace: query.namespace },
  ];
  return METRICS[query.measure].map(metric => ({
    metric,
    query: scopes
      .map(
        scope =>
          `(sum by (${LABELS.join(',')}) (rate(${metric}{${metricSelector({
            reporter: query.reporter,
            ...scope,
          })}}[${query.windowSeconds}s])))`
      )
      .join(' or '),
  }));
}
export const topologyUnit = (measure: TopologyMeasure): 'requests' | 'bytes' | 'messages' =>
  measure === 'requests' ? 'requests' : measure.startsWith('tcp') ? 'bytes' : 'messages';

export interface TopologyEndpoint {
  cluster: string;
  namespace: string;
  workload: string;
  app: string;
  version: string;
  serviceNamespace: string;
  service: string;
}
export interface TopologyObservation {
  source: TopologyEndpoint;
  destination: TopologyEndpoint;
  protocol: string;
  metric: string;
  rate: number;
  code?: string;
  responseFlags: string;
  security: string;
  host: string;
}
export interface TopologyObservations {
  observations: TopologyObservation[];
  warnings: TopologyWarning[];
}
export type TopologyWarning =
  | { code: 'prometheus'; message: string }
  | { code: 'missing-label'; label: string }
  | { code: 'omitted-paths'; count: number }
  | { code: 'service-aliases' | 'service-projection' | 'conflicting-revisions' };
const uniqueWarnings = (warnings: TopologyWarning[]) => [
  ...new Map(warnings.map(warning => [JSON.stringify(warning), warning])).values(),
];
const known = (value: string) => value !== '' && value !== 'unknown';
const versionKnown = (value: string) => known(value) && value !== 'latest';

/** Kiali node-kind/fallback semantics with tuple IDs instead of ambiguous concatenation. */
export function topologyIdentity(endpoint: TopologyEndpoint, mode: TopologyMode) {
  if (!['workload', 'app', 'versionedApp', 'service'].includes(mode))
    throw new Error('Unsupported topology projection');
  const { cluster, workload, app, version, service } = endpoint;
  const namespace = known(endpoint.namespace) ? endpoint.namespace : endpoint.serviceNamespace;
  let parts: string[];
  let kind: 'workload' | 'app' | 'service' | 'unknown';
  if (namespace === 'unknown' && workload === 'unknown' && app === 'unknown' && service === '') {
    parts = [cluster, 'unknown', 'source'];
    kind = 'unknown';
  } else if (workload === 'unknown' && app === 'unknown' && service === 'unknown') {
    parts = ['svc', cluster, namespace, 'unknown'];
    kind = 'service';
  } else {
    if (!known(workload) && !known(app) && !known(service))
      throw new Error('No reported identity is available for this topology endpoint');
    if (mode === 'workload' || mode === 'service') {
      kind = known(workload) ? 'workload' : 'service';
      parts =
        kind === 'workload'
          ? ['wl', cluster, namespace, workload]
          : ['svc', cluster, namespace, known(service) ? service : 'unknown'];
    } else if (known(app)) {
      kind = 'app';
      parts =
        mode === 'versionedApp' && known(workload)
          ? ['vapp', cluster, namespace, workload]
          : mode === 'versionedApp' && versionKnown(version)
          ? ['vapp', cluster, namespace, app, version]
          : ['app', cluster, namespace, app];
    } else {
      kind = known(workload) ? 'workload' : 'service';
      parts = [
        kind === 'workload' ? 'wl' : 'svc',
        cluster,
        namespace,
        kind === 'workload' ? workload : service,
      ];
    }
  }
  return { id: JSON.stringify(parts), parts, kind, cluster, namespace };
}

export function decodeTopology(
  results: readonly { metric: string; result: MetricResult }[],
  query: TopologyQuery
): TopologyObservations {
  const expected = topologyQueries(query).map(item => item.metric);
  if (
    results.length !== expected.length ||
    results.some((item, index) => item.metric !== expected[index])
  )
    throw new Error('Topology metric sources do not match the captured request');
  const observations: TopologyObservation[] = [];
  const warnings: TopologyWarning[] = [];
  const seen = new Set<string>();
  let count = 0;
  for (const { metric, result } of results) {
    if (result.warnings.length > 100 || result.warnings.some(value => value.length > 4096))
      throw new Error('Oversized topology metric warnings');
    result.warnings.forEach(message => warnings.push({ code: 'prometheus', message }));
    for (const series of result.series) {
      if (++count > 4000) throw new Error('Topology exceeds 4000 metric observations');
      const entries = Object.entries(series.labels);
      if (entries.some(([name]) => !LABELS.includes(name)))
        throw new Error('Topology response includes labels outside the requested aggregation');
      if (
        entries.length > 64 ||
        entries.some(([key, value]) => key.length > 128 || value.length > 4096)
      )
        throw new Error('Topology metric labels exceed the bounded label size');
      const identity = JSON.stringify([metric, entries.sort(([a], [b]) => a.localeCompare(b))]);
      if (seen.has(identity)) throw new Error('Duplicate topology metric series');
      seen.add(identity);
      const sample = series.samples[0];
      if (
        series.samples.length !== 1 ||
        !sample ||
        sample.value === null ||
        !Number.isFinite(sample.value) ||
        !Number.isFinite(sample.timestamp) ||
        sample.value < 0 ||
        Math.abs(sample.timestamp - query.end) > 1
      )
        throw new Error('Topology requires fresh finite nonnegative instant rates');
      const labels = series.labels;
      if (labels.reporter !== query.reporter)
        throw new Error('Topology reporter differs from the requested reporter');
      const scoped =
        (labels.source_cluster === query.telemetryCluster &&
          labels.source_workload_namespace === query.namespace) ||
        (labels.destination_cluster === query.telemetryCluster &&
          [labels.destination_workload_namespace, labels.destination_service_namespace].includes(
            query.namespace
          ));
      if (!scoped)
        throw new Error('Topology observation is outside the captured cluster/namespace scope');
      if (!query.includeIdle && sample.value === 0) continue;
      const label = (name: string) => {
        if (!Object.prototype.hasOwnProperty.call(labels, name))
          warnings.push({ code: 'missing-label', label: name });
        return labels[name] ?? 'unknown';
      };
      const endpoint = (side: 'source' | 'destination'): TopologyEndpoint => ({
        cluster: label(`${side}_cluster`),
        namespace: label(`${side}_workload_namespace`),
        workload: label(`${side}_workload`),
        app: label(`${side}_canonical_service`),
        version: label(`${side}_canonical_revision`),
        serviceNamespace:
          side === 'destination'
            ? label('destination_service_namespace')
            : label('source_workload_namespace'),
        service: side === 'destination' ? label('destination_service_name') : '',
      });
      const protocol =
        query.measure === 'requests'
          ? labels.request_protocol
          : query.measure.startsWith('tcp')
          ? 'tcp'
          : 'grpc';
      if (!protocol || protocol.length > 64)
        throw new Error('Topology request protocol is missing or malformed');
      if (
        query.measure !== 'requests' &&
        labels.request_protocol &&
        labels.request_protocol !== protocol
      )
        throw new Error('Topology protocol conflicts with the selected metric family');
      observations.push({
        source: endpoint('source'),
        destination: endpoint('destination'),
        protocol,
        metric,
        rate: sample.value,
        code: query.measure === 'requests' ? requestHealthCode(labels) || 'unknown' : undefined,
        responseFlags: labels.response_flags ?? 'unknown',
        security: labels.connection_security_policy ?? 'unknown',
        host: labels.destination_service ?? 'unknown',
      });
    }
  }
  return { observations, warnings: uniqueWarnings(warnings) };
}

export interface TopologyNode {
  id: string;
  cluster: string;
  namespace: string;
  kind: 'workload' | 'app' | 'service' | 'unknown';
  label: string;
  workloads: string[];
  apps: string[];
  versions: string[];
}

export function topologyNamespacePosition(
  node: Pick<TopologyNode, 'kind' | 'namespace'>,
  selectedNamespace: string
): 'selected' | 'outside' | 'unknown' {
  if (!isDnsLabel(selectedNamespace))
    throw new Error('Graph namespace membership requires an explicit namespace');
  if (node.kind === 'unknown' || !known(node.namespace)) return 'unknown';
  return node.namespace === selectedNamespace ? 'selected' : 'outside';
}

export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  protocol: string;
  rate: number;
  inferred: boolean;
  responses: Record<string, number>;
  flags: Record<string, number>;
  security: Record<string, number>;
  hosts: string[];
  metrics: string[];
}
export interface TopologyGraph {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  warnings: TopologyWarning[];
}
export function projectTopology(input: TopologyObservations, mode: TopologyMode): TopologyGraph {
  if (input.observations.length > 4000) throw new Error('Topology exceeds 4000 observations');
  const nodes = new Map<string, TopologyNode>();
  const edges = new Map<string, TopologyEdge>();
  const warnings = [...input.warnings];
  const parents = new Map<string, Set<string>>();
  const incoming = new Set<string>();
  let contributions = 0;
  const unique = (values: string[], value: string) => {
    if (known(value) && !values.includes(value)) values.push(value);
  };
  function node(endpoint: TopologyEndpoint) {
    const identity = topologyIdentity(endpoint, mode);
    let node = nodes.get(identity.id);
    if (!node) {
      if (nodes.size >= 1000) throw new Error('Topology exceeds 1000 projected nodes');
      node = {
        id: identity.id,
        cluster: identity.cluster,
        namespace: identity.namespace,
        kind: identity.kind,
        label:
          identity.kind === 'workload'
            ? endpoint.workload
            : identity.kind === 'service'
            ? known(endpoint.service)
              ? endpoint.service
              : 'unknown'
            : identity.kind === 'app'
            ? endpoint.app
            : 'unknown',
        workloads: [],
        apps: [],
        versions: [],
      };
      nodes.set(node.id, node);
    }
    unique(node.workloads, endpoint.workload);
    unique(node.apps, endpoint.app);
    unique(node.versions, endpoint.version);
    return node;
  }
  const rows = input.observations.map(observation => {
    if (!Number.isFinite(observation.rate) || observation.rate < 0)
      throw new Error('Invalid projected topology rate');
    const source = node(observation.source);
    const destination = node(observation.destination);
    incoming.add(destination.id);
    let service: TopologyNode | undefined;
    if (
      mode === 'service' &&
      destination.kind === 'workload' &&
      known(observation.destination.service) &&
      observation.destination.service !== 'PassthroughCluster'
    ) {
      service = node({
        ...observation.destination,
        namespace: observation.destination.serviceNamespace,
        workload: 'unknown',
        app: 'unknown',
        version: 'unknown',
      });
      const values = parents.get(destination.id) ?? new Set<string>();
      values.add(service.id);
      parents.set(destination.id, values);
    }
    return { observation, source, destination, service };
  });
  function sum(values: Record<string, number>, key: string, rate: number) {
    const next = (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : 0) + rate;
    if (!Number.isFinite(next)) throw new Error('Topology rate exceeded numeric limits');
    Object.defineProperty(values, key, {
      value: next,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  function add(
    source: TopologyNode,
    target: TopologyNode,
    observation: TopologyObservation,
    inferred: boolean
  ) {
    if (++contributions > 20000) throw new Error('Topology exceeds 20000 projected contributions');
    const id = JSON.stringify([source.id, target.id, observation.protocol]);
    let edge = edges.get(id);
    if (!edge) {
      if (edges.size >= 2000) throw new Error('Topology exceeds 2000 projected edges');
      edge = {
        id,
        source: source.id,
        target: target.id,
        protocol: observation.protocol,
        rate: 0,
        inferred: false,
        responses: {},
        flags: {},
        security: {},
        hosts: [],
        metrics: [],
      };
      edges.set(id, edge);
    }
    edge.rate += observation.rate;
    if (!Number.isFinite(edge.rate)) throw new Error('Topology rate exceeded numeric limits');
    edge.inferred ||= inferred;
    if (observation.code !== undefined) sum(edge.responses, observation.code, observation.rate);
    sum(edge.flags, observation.responseFlags, observation.rate);
    sum(edge.security, observation.security, observation.rate);
    if (!edge.hosts.includes(observation.host)) edge.hosts.push(observation.host);
    if (!edge.metrics.includes(observation.metric)) edge.metrics.push(observation.metric);
  }
  let omitted = 0;
  for (const row of rows) {
    if (mode !== 'service') {
      add(row.source, row.destination, row.observation, false);
      continue;
    }
    const target =
      row.service ?? (row.destination.kind === 'service' ? row.destination : undefined);
    if (!target) {
      omitted++;
      continue;
    }
    const mapped = parents.get(row.source.id);
    if (mapped?.size) {
      if (mapped.size > 1) warnings.push({ code: 'service-aliases' });
      for (const parent of mapped) add(nodes.get(parent)!, target, row.observation, true);
    } else if (!incoming.has(row.source.id) || row.source.kind === 'service') {
      add(row.source, target, row.observation, false);
    } else omitted++;
  }
  if (mode === 'service') {
    warnings.push({ code: 'service-projection' });
    if (omitted) warnings.push({ code: 'omitted-paths', count: omitted });
  }
  const visible = new Set([...edges.values()].flatMap(edge => [edge.source, edge.target]));
  for (const node of nodes.values()) {
    node.workloads.sort();
    node.apps.sort();
    node.versions.sort();
    if (node.kind === 'app' && mode === 'versionedApp') {
      if (node.apps.length !== 1 || node.versions.length > 1)
        warnings.push({ code: 'conflicting-revisions' });
      node.label = `${node.apps.length === 1 ? node.apps[0] : node.workloads[0] ?? node.label}${
        node.versions.length === 1 && versionKnown(node.versions[0]) ? `@${node.versions[0]}` : ''
      }${node.workloads.length === 1 ? ` [${node.workloads[0]}]` : ''}`;
    }
  }
  return {
    nodes: [...nodes.values()]
      .filter(node => mode !== 'service' || node.kind === 'service' || visible.has(node.id))
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
    warnings: uniqueWarnings(warnings),
  };
}

export function filterTopology(graph: TopologyGraph, search: string): TopologyGraph {
  if (!search) return graph;
  if (search.length > 256) throw new Error('Topology filter exceeds 256 characters');
  const query = search.toLowerCase();
  const matching = new Set(
    graph.nodes
      .filter(node =>
        [node.label, node.cluster, node.namespace, ...node.workloads, ...node.apps].some(value =>
          value.toLowerCase().includes(query)
        )
      )
      .map(node => node.id)
  );
  const edges = graph.edges.filter(edge => matching.has(edge.source) || matching.has(edge.target));
  const visible = new Set([...matching, ...edges.flatMap(edge => [edge.source, edge.target])]);
  return { ...graph, nodes: graph.nodes.filter(node => visible.has(node.id)), edges };
}
