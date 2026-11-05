import type { AccountObservation, CorrelationResource, OwnerReference } from './correlation';
import { isDnsSubdomain } from './object';
import { ResourceIdentity } from './scope';

export interface WorkloadAccountSource {
  source: { kind: string; group: string; apiVersion: string };
  resources: readonly CorrelationResource[];
  complete: boolean;
  resourceVersion?: string;
  relatedVersions?: { kind: string; apiVersion: string; resourceVersion: string }[];
  notServed?: boolean;
}

export interface WorkloadAccountCapture {
  scope: { cluster: string; namespace: string };
  sources: readonly WorkloadAccountSource[];
  accountSources?: readonly WorkloadAccountSource[];
}

export interface WorkloadPodAccount {
  identity: ResourceIdentity & { kind: 'Pod'; namespace: string; uid: string };
  account: AccountObservation;
}

export interface WorkloadAccountRecord {
  identity: ResourceIdentity & { namespace: string; uid: string };
  pods: WorkloadPodAccount[];
  accounts: { name: string; count: number }[];
  unavailable: { name: string; uid: string; message: string }[];
}

export interface VMAccountRecord {
  identity: ResourceIdentity & { kind: 'WorkloadGroup'; namespace: string; uid: string };
  entries: {
    name: string;
    uid: string;
    resourceVersion: string;
    serviceAccount: AccountObservation;
  }[];
}

export interface WorkloadAccountProjection {
  scope: { cluster: string; namespace: string };
  profile: 'kiali-v2.33-default';
  complete: boolean;
  workloads: WorkloadAccountRecord[];
  vmWorkloads: VMAccountRecord[];
  issues: string[];
}

const requiredKinds = [
  'Deployment',
  'ReplicaSet',
  'StatefulSet',
  'DaemonSet',
  'ReplicationController',
  'Job',
  'CronJob',
  'Pod',
  'WorkloadGroup',
  'DeploymentConfig',
] as const;
const includedKinds = new Set(['Deployment', 'ReplicaSet', 'StatefulSet', 'DaemonSet', 'Pod']);
const excludedKinds = new Set(['Job', 'CronJob', 'ReplicationController', 'DeploymentConfig']);
const groups: Record<(typeof requiredKinds)[number], string> = {
  Deployment: 'apps',
  ReplicaSet: 'apps',
  StatefulSet: 'apps',
  DaemonSet: 'apps',
  ReplicationController: '',
  Job: 'batch',
  CronJob: 'batch',
  Pod: '',
  WorkloadGroup: 'networking.istio.io',
  DeploymentConfig: 'apps.openshift.io',
};
const ownersByKind: Record<string, ReadonlySet<string>> = {
  Pod: new Set([
    'Deployment',
    'ReplicaSet',
    'StatefulSet',
    'DaemonSet',
    'ReplicationController',
    'Job',
    'CronJob',
    'DeploymentConfig',
  ]),
  ReplicaSet: new Set(['Deployment']),
  ReplicationController: new Set(['DeploymentConfig']),
  Job: new Set(['CronJob']),
};
const validVersion = (value: unknown) =>
  typeof value === 'string' && value.length > 0 && value.length <= 1024 && value.trim() === value;
const identityKey = (identity: ResourceIdentity & { namespace: string; uid: string }) =>
  JSON.stringify([identity.cluster, identity.namespace, identity.uid]);
const apiGroup = (apiVersion: string) => {
  const parts = apiVersion.split('/');
  return parts.length === 2 ? parts[0] : '';
};

function isAccount(value: unknown): value is AccountObservation {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return false;
  return value.ok === true
    ? 'name' in value && typeof value.name === 'string' && value.name.length > 0
    : value.ok === false && 'message' in value && typeof value.message === 'string';
}

function ownerMatches(
  owner: OwnerReference,
  parent: CorrelationResource,
  parentVersion: string | undefined
): boolean {
  return (
    !!parentVersion &&
    owner.apiVersion === parentVersion &&
    owner.group === parent.identity.group &&
    owner.kind === parent.identity.kind &&
    owner.name === parent.identity.name &&
    owner.uid === parent.identity.uid
  );
}

export function projectWorkloadAccounts(
  capture: WorkloadAccountCapture
): WorkloadAccountProjection {
  const issues = new Set<string>();
  const sources = [...capture.sources, ...(capture.accountSources ?? [])].filter(
    source => source.source.kind !== 'Service'
  );
  const sourcesByKind = new Map<string, WorkloadAccountSource>();
  for (const source of sources) {
    if (sourcesByKind.has(source.source.kind)) {
      issues.add(`Duplicate ${source.source.kind} source capture`);
      continue;
    }
    sourcesByKind.set(source.source.kind, source);
  }
  for (const kind of requiredKinds) {
    const source = sourcesByKind.get(kind);
    if (!source) {
      issues.add(`${kind} source was not captured`);
      continue;
    }
    if (
      source.source.group !== groups[kind] ||
      !validVersion(source.source.apiVersion) ||
      apiGroup(source.source.apiVersion) !== groups[kind]
    )
      issues.add(`${kind} source identity is invalid`);
    const optionalAbsent =
      source.notServed === true && (kind === 'WorkloadGroup' || kind === 'DeploymentConfig');
    if (source.complete !== true) issues.add(`${kind} source is incomplete`);
    if (source.notServed && !optionalAbsent)
      issues.add(`${kind} source availability is unresolved`);
    if (!source.notServed && !validVersion(source.resourceVersion))
      issues.add(`${kind} list version is missing or malformed`);
    if (source.notServed && source.resources.length)
      issues.add(`${kind} source reports resources while not served`);
    if (kind === 'WorkloadGroup' && !source.notServed) {
      const selectedGroups = source.resources.filter(
        resource =>
          resource.identity.kind === 'WorkloadGroup' &&
          resource.virtualMachine?.selectorEmpty !== true
      );
      if (selectedGroups.length) {
        const entries = source.relatedVersions?.find(item => item.kind === 'WorkloadEntry');
        if (
          !entries ||
          !validVersion(entries.apiVersion) ||
          !validVersion(entries.resourceVersion) ||
          apiGroup(entries.apiVersion) !== 'networking.istio.io'
        )
          issues.add('WorkloadEntry list version is missing or malformed');
      }
    }
  }

  const versions = new Map(
    [...sourcesByKind].map(([kind, source]) => [kind, source.source.apiVersion])
  );
  const resourcesByUid = new Map<string, CorrelationResource>();
  const names = new Set<string>();
  const allResources: CorrelationResource[] = [];
  let resourceCount = 0;
  for (const source of sources) {
    if (source.notServed) continue;
    for (const resource of source.resources) {
      resourceCount++;
      if (resourceCount > 11000) {
        issues.add('Workload/account source exceeds 11000 resources');
        break;
      }
      const id = resource.identity;
      const sourceKind = source.source.kind;
      if (
        id.cluster !== capture.scope.cluster ||
        id.namespace !== capture.scope.namespace ||
        id.kind !== sourceKind ||
        id.group !== source.source.group ||
        !isDnsSubdomain(id.name) ||
        !validVersion(id.uid) ||
        !validVersion(resource.resourceVersion)
      ) {
        issues.add(`${sourceKind} resource identity or version is invalid or out of scope`);
        continue;
      }
      const key = identityKey(id);
      const nameKey = JSON.stringify([id.group, id.kind, id.namespace, id.name]);
      if (resourcesByUid.has(key) || names.has(nameKey)) {
        issues.add(`${sourceKind} contains duplicate scoped resource identities`);
        continue;
      }
      names.add(nameKey);
      resourcesByUid.set(key, resource);
      allResources.push(resource);
    }
  }

  const roots = new Map<string, CorrelationResource | null>();
  function resolveRoot(resource: CorrelationResource): CorrelationResource | null {
    const path: CorrelationResource[] = [];
    const visited = new Set<string>();
    let current = resource;
    let resolved: CorrelationResource | null = null;
    while (true) {
      const key = identityKey(current.identity);
      if (roots.has(key)) {
        resolved = roots.get(key) ?? null;
        break;
      }
      if (visited.has(key)) {
        issues.add(`${current.identity.kind}/${current.identity.name} has an owner cycle`);
        break;
      }
      visited.add(key);
      path.push(current);
      if (!Array.isArray(current.owners) || current.owners.length > 20) {
        issues.add(
          `${current.identity.kind}/${current.identity.name} has invalid owner references`
        );
        break;
      }
      const controllers = current.owners.filter(owner => owner.controller);
      if (controllers.length > 1) {
        issues.add(
          `${current.identity.kind}/${current.identity.name} has ambiguous controller owners`
        );
        break;
      }
      if (controllers.length === 0) {
        if (current.identity.kind === 'Pod' && current.owners.length > 0) {
          issues.add(
            `${current.identity.kind}/${current.identity.name} has owner references without a controller`
          );
          break;
        }
        resolved = current;
        break;
      }
      const owner = controllers[0];
      if (!ownersByKind[current.identity.kind]?.has(owner.kind)) {
        issues.add(
          `${current.identity.kind}/${current.identity.name} has an unsupported ${owner.kind} controller`
        );
        break;
      }
      if (!validVersion(owner.apiVersion) || apiGroup(owner.apiVersion) !== owner.group) {
        issues.add(
          `${current.identity.kind}/${current.identity.name} has an invalid owner API version`
        );
        break;
      }
      const parent = resourcesByUid.get(
        identityKey({
          cluster: current.identity.cluster,
          namespace: current.identity.namespace,
          uid: owner.uid,
          group: owner.group,
          kind: owner.kind,
          name: owner.name,
        })
      );
      if (!parent || !ownerMatches(owner, parent, versions.get(owner.kind))) {
        issues.add(
          `${current.identity.kind}/${current.identity.name} has a missing or stale owner`
        );
        break;
      }
      if (excludedKinds.has(owner.kind)) {
        resolved = null;
        break;
      }
      current = parent;
    }
    for (const item of path) roots.set(identityKey(item.identity), resolved);
    return resolved;
  }

  const workloadMap = new Map<string, WorkloadAccountRecord>();
  const pods = allResources.filter(resource => resource.identity.kind === 'Pod');
  for (const resource of allResources) {
    if (!includedKinds.has(resource.identity.kind)) continue;
    const root = resolveRoot(resource);
    if (!root || !includedKinds.has(root.identity.kind)) continue;
    const key = identityKey(root.identity);
    if (!workloadMap.has(key))
      workloadMap.set(key, { identity: root.identity, pods: [], accounts: [], unavailable: [] });
  }
  for (const pod of pods) {
    const root = resolveRoot(pod);
    if (!root || !includedKinds.has(root.identity.kind)) continue;
    const workload = workloadMap.get(identityKey(root.identity));
    if (!workload) {
      issues.add(`Pod/${pod.identity.name} has no included workload attribution`);
      continue;
    }
    const account = pod.podAccount;
    const observation = isAccount(account)
      ? account
      : { ok: false as const, message: 'Pod service account evidence was not collected' };
    workload.pods.push({
      identity: pod.identity as WorkloadPodAccount['identity'],
      account: observation,
    });
    if (observation.ok === true) {
      if (!isDnsSubdomain(observation.name)) {
        issues.add(`Pod/${pod.identity.name} has a malformed service account`);
        workload.unavailable.push({
          name: pod.identity.name,
          uid: pod.identity.uid,
          message: 'Pod service account name is malformed',
        });
      } else {
        const current = workload.accounts.find(item => item.name === observation.name);
        if (current) current.count++;
        else workload.accounts.push({ name: observation.name, count: 1 });
      }
    } else if (observation.ok === false) {
      issues.add(`Pod/${pod.identity.name} has unavailable service account evidence`);
      workload.unavailable.push({
        name: pod.identity.name,
        uid: pod.identity.uid,
        message: observation.message,
      });
    }
  }
  for (const workload of workloadMap.values()) {
    workload.pods.sort((a, b) => a.identity.name.localeCompare(b.identity.name));
    workload.accounts.sort((a, b) => a.name.localeCompare(b.name));
    workload.unavailable.sort((a, b) => a.name.localeCompare(b.name));
  }

  const vmWorkloads: VMAccountRecord[] = [];
  for (const resource of allResources.filter(item => item.identity.kind === 'WorkloadGroup')) {
    const vm = resource.virtualMachine;
    if (
      !vm ||
      typeof vm.selectorEmpty !== 'boolean' ||
      !Array.isArray(vm.accountEntries) ||
      vm.matchingEntries !== vm.accountEntries.length
    ) {
      issues.add(`WorkloadGroup/${resource.identity.name} account provenance is incomplete`);
      continue;
    }
    if (vm.selectorEmpty && vm.accountEntries.length) {
      issues.add(`WorkloadGroup/${resource.identity.name} imported entries for an empty selector`);
      continue;
    }
    if (
      (vm.accountEntries.length > 0 &&
        (vm.labelSource !== 'entry' ||
          !vm.entry ||
          vm.entry.name !== vm.accountEntries[0].name ||
          vm.entry.uid !== vm.accountEntries[0].uid ||
          vm.entry.resourceVersion !== vm.accountEntries[0].resourceVersion)) ||
      (vm.accountEntries.length === 0 && (vm.labelSource !== 'group' || vm.entry !== undefined))
    ) {
      issues.add(`WorkloadGroup/${resource.identity.name} has inconsistent first-entry provenance`);
      continue;
    }
    const entries = vm.accountEntries.map(entry => {
      if (
        !isDnsSubdomain(entry.name) ||
        !validVersion(entry.uid) ||
        !validVersion(entry.resourceVersion) ||
        !isAccount(entry.serviceAccount)
      ) {
        issues.add(
          `WorkloadGroup/${resource.identity.name} has malformed WorkloadEntry account data`
        );
        return {
          ...entry,
          serviceAccount: {
            ok: false as const,
            message: 'WorkloadEntry service account evidence is malformed',
          },
        };
      }
      if (!entry.serviceAccount.ok)
        issues.add(
          `WorkloadGroup/${resource.identity.name} has unavailable WorkloadEntry account data`
        );
      return entry;
    });
    vmWorkloads.push({
      identity: resource.identity as VMAccountRecord['identity'],
      entries,
    });
  }

  vmWorkloads.sort((a, b) => a.identity.name.localeCompare(b.identity.name));
  return {
    scope: capture.scope,
    profile: 'kiali-v2.33-default',
    complete: issues.size === 0,
    workloads: [...workloadMap.values()].sort((a, b) =>
      a.identity.name.localeCompare(b.identity.name)
    ),
    vmWorkloads,
    issues: [...issues].sort(),
  };
}
