import { getClusterConfig, KialiConfig } from './config';
import { correlateResources, CorrelationResource } from './correlation';
import { AppLabels } from './labels';
import { isDnsLabel, isDnsSubdomain } from './object';
import { TopologyNode } from './topology';

export interface GraphResourceTarget {
  cluster: string;
  namespace: string;
  kind: 'workload' | 'service';
  names: string[];
}
export function captureGraphResourceTarget(target: GraphResourceTarget): GraphResourceTarget {
  if (
    !target.cluster.trim() ||
    !isDnsLabel(target.namespace) ||
    !['workload', 'service'].includes(target.kind) ||
    !Array.isArray(target.names) ||
    !target.names.length ||
    target.names.length > 20 ||
    new Set(target.names).size !== target.names.length ||
    target.names.some(
      name =>
        name === 'unknown' || !(target.kind === 'service' ? isDnsLabel(name) : isDnsSubdomain(name))
    )
  )
    throw new Error(
      'Graph resource lookup requires an explicit cluster, namespace and 1 to 20 distinct reported Kubernetes names'
    );
  return { ...target, names: [...target.names] };
}
export function graphResourceTarget(
  node: TopologyNode,
  current: { cluster: string; telemetryCluster: string },
  config: KialiConfig,
  available: readonly string[]
): GraphResourceTarget {
  if (!node.cluster || node.cluster === 'unknown' || node.kind === 'unknown')
    throw new Error('This graph node has no usable reported cluster/resource identity');
  const matches = new Set(
    available.filter(cluster => getClusterConfig(config, cluster).telemetryCluster === node.cluster)
  );
  if (node.cluster === current.telemetryCluster && available.includes(current.cluster))
    matches.add(current.cluster);
  if (matches.size !== 1)
    throw new Error(
      matches.size
        ? 'This telemetry identity maps to multiple Headlamp contexts; no context was chosen'
        : 'No explicit Headlamp mapping exists for this telemetry identity'
    );
  return captureGraphResourceTarget({
    cluster: [...matches][0],
    namespace: node.namespace,
    kind: node.kind === 'service' ? 'service' : 'workload',
    names: node.kind === 'service' ? [node.label] : [...node.workloads],
  });
}
export function graphResourceCandidates(
  target: GraphResourceTarget,
  resources: readonly CorrelationResource[],
  labels?: AppLabels | null
) {
  const captured = captureGraphResourceTarget(target);
  if (
    resources.some(
      resource =>
        resource.identity.cluster !== captured.cluster ||
        resource.identity.namespace !== captured.namespace
    )
  )
    throw new Error('Graph resource evidence is outside the captured cluster/namespace');
  const correlated = correlateResources(resources, labels);
  if (correlated.issues.length)
    throw new Error('Unresolved workload ownership prevents graph resource correlation');
  const candidates: {
    identity: CorrelationResource['identity'];
    app: string | null;
    version: string | null;
    virtualMachine?: CorrelationResource['virtualMachine'];
  }[] = [];
  const unresolved: { name: string; reason: 'not-observed' | 'ambiguous' }[] = [];
  for (const name of captured.names) {
    const matches =
      captured.kind === 'service'
        ? correlated.serviceRelations
            .filter(item => item.service.identity.name === name)
            .map(item => ({ identity: item.service.identity, app: null, version: null }))
        : correlated.workloads
            .filter(item => item.identity.name === name)
            .map(item => ({
              identity: item.identity,
              app: item.app?.value ?? null,
              version: item.version?.value ?? null,
              ...(item.resource.virtualMachine
                ? { virtualMachine: item.resource.virtualMachine }
                : {}),
            }));
    if (matches.length === 1) candidates.push(matches[0]);
    else unresolved.push({ name, reason: matches.length ? 'ambiguous' : 'not-observed' });
  }
  return { candidates, unresolved };
}
