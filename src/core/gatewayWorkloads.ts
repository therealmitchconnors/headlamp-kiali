import type { CorrelationResource } from './correlation';
import { decodeLabelSelector, isLabelKey, isLabelValue, matchesSelector } from './labels';
import { isDnsLabel, isDnsSubdomain } from './object';
import type { Finding } from './validation';
import type { VirtualWorkloadGroup, VirtualWorkloadRecord } from './virtualWorkloads';
import {
  workloadEntryLabels,
  workloadEntryMatches,
  workloadLabelBudget,
} from './workloadGroupEntries';

export interface GatewayWorkload {
  kind: string;
  namespace: string;
  name: string;
  uid: string;
  resourceVersion: string;
  labels: Readonly<Record<string, string>>;
  entry?: { namespace: string; name: string; uid: string; resourceVersion: string };
}
export interface GatewayWorkloadContext {
  complete: boolean;
  namespaces: readonly string[];
  scopeToNamespace: boolean;
  items: readonly GatewayWorkload[];
}
const nativeKinds = new Map([
  ['Deployment', 'apps'],
  ['ReplicaSet', 'apps'],
  ['StatefulSet', 'apps'],
  ['DaemonSet', 'apps'],
  ['Pod', ''],
]);
const excludedKinds = new Set(['Job', 'CronJob', 'ReplicationController', 'DeploymentConfig']);

// This projection is deliberately separate from application correlation: Kiali's default
// workload inclusion excludes Jobs/RCs and does not count owned Pods or child ReplicaSets.
export function gatewayWorkloadProjection(
  cluster: string,
  namespaces: readonly string[],
  resources: readonly CorrelationResource[],
  groups: readonly VirtualWorkloadGroup[],
  entries: readonly VirtualWorkloadRecord[]
): GatewayWorkload[] {
  if (
    resources.length + groups.length + entries.length > 7000 ||
    namespaces.length > 1000 ||
    new Set(namespaces).size !== namespaces.length ||
    namespaces.some(namespace => !isDnsLabel(namespace))
  )
    throw new Error('Gateway workload projection exceeds limits or has invalid namespace scope');
  const allowed = new Set(namespaces);
  const countLabels = workloadLabelBudget();
  let labelCount = 0;
  const uids = new Set<string>();
  const names = new Set<string>();
  function identity(record: VirtualWorkloadRecord, kind: string) {
    if (
      !allowed.has(record.namespace) ||
      !isDnsSubdomain(record.name) ||
      [record.uid, record.resourceVersion].some(
        value =>
          typeof value !== 'string' || !value || value.trim() !== value || value.length > 1024
      ) ||
      uids.has(record.uid) ||
      names.has(JSON.stringify([kind, record.namespace, record.name]))
    )
      throw new Error(
        'Gateway workload evidence has invalid, duplicate or out-of-scope identities'
      );
    uids.add(record.uid);
    names.add(JSON.stringify([kind, record.namespace, record.name]));
  }
  function labels(value: unknown) {
    const parsed = workloadEntryLabels(value);
    countLabels(parsed);
    labelCount += Object.keys(parsed).length;
    if (labelCount > 20000) throw new Error('Gateway workload context exceeds 20000 labels');
    if (Object.entries(parsed).some(([key, value]) => !isLabelKey(key) || !isLabelValue(value)))
      throw new Error('Gateway workload labels are malformed');
    return parsed;
  }
  const byName = new Map<string, CorrelationResource>();
  const key = (namespace: string, name: string) => JSON.stringify([namespace, name]);
  for (const resource of resources) {
    const id = resource.identity;
    if (
      id.cluster !== cluster ||
      !nativeKinds.has(id.kind) ||
      nativeKinds.get(id.kind) !== id.group ||
      resource.owners.length > 20 ||
      resource.owners.filter(owner => owner.controller).length > 1
    )
      throw new Error('Unsupported or ambiguous Gateway workload/controller evidence');
    identity({ ...id, resourceVersion: resource.resourceVersion ?? '', labels: {} }, id.kind);
    labels(resource.labels);
    labels(resource.workloadLabels);
    const nameKey = key(id.namespace, id.name);
    if (byName.has(nameKey))
      throw new Error('Gateway workload controller-priority name collisions are not supported');
    byName.set(nameKey, resource);
  }
  const selected = new Set<CorrelationResource>();
  for (const resource of resources) {
    if (['Deployment', 'StatefulSet', 'DaemonSet'].includes(resource.identity.kind))
      selected.add(resource);
    else if (resource.owners.length === 0) selected.add(resource);
    if (resource.identity.kind === 'ReplicaSet') {
      const owner = resource.owners.find(owner => owner.controller);
      if (owner && !nativeKinds.has(owner.kind) && !excludedKinds.has(owner.kind))
        throw new Error('Custom ReplicaSet parent workload inclusion is not supported');
    }
  }
  function parent(resource: CorrelationResource): CorrelationResource | undefined {
    const owner = resource.owners.find(owner => owner.controller);
    if (!owner) return undefined;
    if (excludedKinds.has(owner.kind)) return undefined;
    if (!nativeKinds.has(owner.kind) || nativeKinds.get(owner.kind) !== owner.group)
      throw new Error('Custom or unsupported Pod controller workload inclusion is not supported');
    const found = byName.get(key(resource.identity.namespace, owner.name));
    if (
      !found ||
      found.identity.kind !== owner.kind ||
      found.identity.group !== owner.group ||
      found.identity.uid !== owner.uid
    )
      throw new Error('Gateway workload ownership is missing or stale');
    return found;
  }
  for (const pod of resources.filter(resource => resource.identity.kind === 'Pod')) {
    const owner = parent(pod);
    if (!owner) continue;
    if (owner.identity.kind === 'ReplicaSet') {
      const ancestor = parent(owner);
      if (ancestor) {
        if (!['Deployment', 'StatefulSet', 'DaemonSet'].includes(ancestor.identity.kind))
          throw new Error('Unsupported Gateway workload owner chain');
        selected.add(ancestor);
      } else if (!owner.owners.some(ref => ref.controller)) selected.add(owner);
    } else if (['Deployment', 'StatefulSet', 'DaemonSet'].includes(owner.identity.kind))
      selected.add(owner);
    else throw new Error('Unsupported Gateway workload owner chain');
  }
  for (const group of groups) {
    identity(group, 'WorkloadGroup');
    labels(group.labels);
    labels(group.selector);
    if (byName.has(key(group.namespace, group.name)))
      throw new Error(
        'Gateway WorkloadGroup/controller-priority name collisions are not supported'
      );
  }
  for (const entry of entries) {
    identity(entry, 'WorkloadEntry');
    labels(entry.labels);
  }
  let comparisons = 0;
  const virtual = groups.map(group => {
    const first = Object.keys(group.selector).length
      ? entries.find(entry => {
          if (++comparisons > 20000)
            throw new Error('Gateway VM label projection exceeds 20000 comparisons');
          return workloadEntryMatches(group.selector, entry.labels);
        })
      : undefined;
    return {
      kind: 'WorkloadGroup',
      namespace: group.namespace,
      name: group.name,
      uid: group.uid,
      resourceVersion: group.resourceVersion,
      labels: { ...(first ? first.labels : group.selector) },
      ...(first
        ? {
            entry: {
              namespace: first.namespace,
              name: first.name,
              uid: first.uid,
              resourceVersion: first.resourceVersion,
            },
          }
        : {}),
    };
  });
  return [
    ...[...selected].map(resource => ({
      kind: resource.identity.kind,
      namespace: resource.identity.namespace,
      name: resource.identity.name,
      uid: resource.identity.uid,
      resourceVersion: resource.resourceVersion ?? '',
      labels: { ...(resource.identity.kind === 'Pod' ? resource.labels : resource.workloadLabels) },
    })),
    ...virtual,
  ];
}

export function gatewaySelectorChecks(
  namespace: string,
  spec: Record<string, unknown>,
  context: GatewayWorkloadContext
): Finding[] {
  if (
    context.complete !== true ||
    typeof context.scopeToNamespace !== 'boolean' ||
    !context.namespaces.includes(namespace)
  )
    throw new Error(
      'Gateway selector checks require complete declared namespace/workload evidence'
    );
  const selector = decodeLabelSelector({ matchLabels: spec.selector ?? {} });
  if (
    context.items.some(
      workload =>
        (!context.scopeToNamespace || workload.namespace === namespace) &&
        matchesSelector(workload.labels, selector)
    )
  )
    return [];
  return [
    {
      code: 'KIA0302',
      severity: 'warning',
      path: 'spec/selector',
      message: 'No matching workload found for gateway selector in this namespace',
    },
  ];
}
