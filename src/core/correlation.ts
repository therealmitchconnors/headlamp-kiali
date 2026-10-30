import type { PodDashboardReferences } from './applicationDashboards';
import { AppLabels, applicationLabels, labelIndex, Labels, LabelValue } from './labels';
import { ResourceIdentity, resourceKey } from './scope';
import type { WorkloadHealthResource } from './workloadHealth';

export type CorrelationKind =
  | 'Deployment'
  | 'StatefulSet'
  | 'DaemonSet'
  | 'ReplicaSet'
  | 'ReplicationController'
  | 'Job'
  | 'CronJob'
  | 'Pod'
  | 'WorkloadGroup'
  | 'Service';

export interface OwnerReference {
  group: string;
  kind: string;
  name: string;
  uid: string;
  controller: boolean;
}

export interface CorrelationResource {
  identity: ResourceIdentity & { kind: CorrelationKind; namespace: string; uid: string };
  labels: Labels;
  workloadLabels: Labels;
  owners: readonly OwnerReference[];
  serviceSelector: Labels | null;
  proxyMode: 'sidecar' | 'native-sidecar' | 'none';
  resourceVersion?: string;
  podAccount?: { ok: true; name: string } | { ok: false; message: string };
  dashboardRefs?: PodDashboardReferences;
  virtualMachine?: {
    labelSource: 'group' | 'entry';
    matchingEntries: number;
    entry?: { name: string; uid: string; resourceVersion: string };
  };
  health?:
    | { ok: true; value: Pick<WorkloadHealthResource, 'replicas' | 'stale'> }
    | { ok: false; message: string };
}

export interface CorrelatedWorkload {
  identity: CorrelationResource['identity'];
  resource: CorrelationResource;
  pods: CorrelationResource[];
  services: CorrelationResource[];
  app: LabelValue | null;
  version: LabelValue | null;
  infrastructure: boolean;
}

export interface Application {
  id: string;
  name: string;
  cluster: string;
  namespace: string;
  versions: (string | null)[];
  workloads: CorrelatedWorkload[];
  services: CorrelationResource[];
  pods: CorrelationResource[];
}

export interface OwnershipIssue {
  resource: CorrelationResource['identity'];
  reason:
    | 'unresolved-owner'
    | 'ambiguous-owner'
    | 'owner-mismatch'
    | 'owner-cycle'
    | 'unsupported-owner';
}

export interface ServiceRelations {
  service: CorrelationResource;
  workloads: CorrelatedWorkload[];
  pods: CorrelationResource[];
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const uidKey = (identity: { cluster: string; namespace?: string; uid?: string }) =>
  JSON.stringify([identity.cluster, identity.namespace ?? '', identity.uid]);
const sortedResources = (items: readonly CorrelationResource[]) =>
  [...items].sort((a, b) => compare(resourceKey(a.identity), resourceKey(b.identity)));

export function correlateResources(
  resources: readonly CorrelationResource[],
  labels?: AppLabels | null
) {
  const ordered = sortedResources(resources);
  const byUid = new Map<string, CorrelationResource>();
  const names = new Set<string>();
  for (const resource of ordered) {
    const key = uidKey(resource.identity);
    if (byUid.has(key)) throw new Error('Correlation snapshot contains a duplicate scoped UID');
    const name = resourceKey({ ...resource.identity, uid: undefined });
    if (names.has(name)) throw new Error('Correlation snapshot contains a duplicate scoped name');
    names.add(name);
    byUid.set(key, resource);
  }
  const issues: OwnershipIssue[] = [];
  const issueKeys = new Set<string>();
  function issue(resource: CorrelationResource, reason: OwnershipIssue['reason']) {
    const key = JSON.stringify([resourceKey(resource.identity), reason]);
    if (!issueKeys.has(key)) {
      issueKeys.add(key);
      issues.push({ resource: resource.identity, reason });
    }
  }
  const roots = new Map<string, CorrelationResource | null>();
  function root(resource: CorrelationResource): CorrelationResource | null {
    const path: CorrelationResource[] = [];
    const visited = new Set<string>();
    let current = resource;
    let resolved: CorrelationResource | null;
    while (true) {
      const key = uidKey(current.identity);
      if (roots.has(key)) {
        resolved = roots.get(key) ?? null;
        break;
      }
      if (visited.has(key)) {
        issue(current, 'owner-cycle');
        resolved = null;
        break;
      }
      visited.add(key);
      path.push(current);
      const controllers = current.owners.filter(owner => owner.controller);
      if (controllers.length === 0) {
        resolved = current;
        break;
      }
      if (controllers.length !== 1) {
        issue(current, 'ambiguous-owner');
        resolved = null;
        break;
      }
      const owner = controllers[0];
      const parent = byUid.get(uidKey({ ...current.identity, uid: owner.uid }));
      if (!parent) {
        issue(current, 'unresolved-owner');
        resolved = current.identity.kind === 'Pod' ? null : current;
        break;
      }
      if (
        parent.identity.group !== owner.group ||
        parent.identity.kind !== owner.kind ||
        parent.identity.name !== owner.name
      ) {
        issue(current, 'owner-mismatch');
        resolved = null;
        break;
      }
      if (parent.identity.kind === 'Service' || parent.identity.kind === 'WorkloadGroup') {
        issue(current, 'unsupported-owner');
        resolved = null;
        break;
      }
      current = parent;
    }
    for (const item of path) roots.set(uidKey(item.identity), resolved);
    return resolved;
  }

  const workloadsById = new Map<string, CorrelatedWorkload>();
  for (const resource of ordered.filter(item => item.identity.kind !== 'Service')) {
    const owner = root(resource);
    if (owner && !workloadsById.has(uidKey(owner.identity))) {
      const selected = applicationLabels(owner.workloadLabels, labels);
      workloadsById.set(uidKey(owner.identity), {
        identity: owner.identity,
        resource: owner,
        pods: [],
        services: [],
        ...selected,
        infrastructure: false,
      });
    }
  }
  const pods = ordered.filter(item => item.identity.kind === 'Pod');
  const unassignedPods: CorrelationResource[] = [];
  for (const pod of pods) {
    const owner = root(pod);
    const workload = owner ? workloadsById.get(uidKey(owner.identity)) : undefined;
    if (workload) workload.pods.push(pod);
    else unassignedPods.push(pod);
  }
  const workloads = [...workloadsById.values()].sort((a, b) =>
    compare(resourceKey(a.identity), resourceKey(b.identity))
  );
  const workloadIndex = labelIndex(workloads, workload => workload.resource.workloadLabels);
  const podIndex = labelIndex(pods, pod => pod.labels);
  const serviceRelations: ServiceRelations[] = ordered
    .filter(item => item.identity.kind === 'Service')
    .map(service => {
      const selector = service.serviceSelector;
      const scope = service.identity;
      if (!selector || Object.keys(selector).length === 0) {
        return { service, workloads: [], pods: [] };
      }
      const matches = workloadIndex.select(scope.cluster, scope.namespace, {
        matchLabels: selector,
      });
      for (const workload of matches) workload.services.push(service);
      return {
        service,
        workloads: matches,
        pods: podIndex.select(scope.cluster, scope.namespace, { matchLabels: selector }),
      };
    });

  const applications = new Map<string, Application>();
  const applicationServices = new Map<string, Set<string>>();
  for (const workload of workloads) {
    const values = workload.resource.workloadLabels;
    workload.infrastructure =
      values['gateway.istio.io/managed'] === 'istio.io-mesh-controller' ||
      (values['gateway.networking.k8s.io/gateway-name'] ?? '').toLowerCase().includes('waypoint') ||
      workload.pods.some(pod => pod.labels.app === 'ztunnel');
    if (workload.infrastructure || workload.app === null) continue;
    const { cluster, namespace } = workload.identity;
    const name = workload.app.value;
    const id = JSON.stringify([cluster, namespace, name]);
    const app: Application = applications.get(id) ?? {
      id,
      name,
      cluster,
      namespace,
      versions: [],
      workloads: [],
      services: [],
      pods: [],
    };
    const serviceIds = applicationServices.get(id) ?? new Set<string>();
    app.workloads.push(workload);
    app.pods.push(...workload.pods);
    const version = workload.version?.value ?? null;
    if (!app.versions.includes(version)) app.versions.push(version);
    for (const service of workload.services) {
      const serviceId = resourceKey(service.identity);
      if (!serviceIds.has(serviceId)) {
        serviceIds.add(serviceId);
        app.services.push(service);
      }
    }
    applicationServices.set(id, serviceIds);
    applications.set(id, app);
  }
  for (const app of applications.values()) {
    app.versions.sort((a, b) =>
      a === null ? (b === null ? 0 : 1) : b === null ? -1 : compare(a, b)
    );
    app.services = sortedResources(app.services);
    app.pods = sortedResources(app.pods);
  }
  return {
    applications: [...applications.values()].sort((a, b) => compare(a.id, b.id)),
    workloads,
    serviceRelations,
    issues,
    unassignedPods,
    unlabelledWorkloads: workloads.filter(
      workload => !workload.infrastructure && workload.app === null
    ),
    infrastructure: workloads.filter(workload => workload.infrastructure),
  };
}

/** Resolve only Kubernetes Service DNS forms; external and wildcard hosts remain unresolved. */
export function resolveServiceHost(
  host: string,
  cluster: string,
  namespace: string,
  services: readonly CorrelationResource[],
  domain = 'cluster.local'
): CorrelationResource | null {
  const normalized = host.toLowerCase().replace(/\.$/, '');
  for (const service of services) {
    const identity = service.identity;
    if (identity.kind !== 'Service' || identity.cluster !== cluster) continue;
    const qualified = `${identity.name}.${identity.namespace}`;
    const names = [qualified, `${qualified}.svc`, `${qualified}.svc.${domain}`];
    if (identity.namespace === namespace) names.push(identity.name);
    if (names.includes(normalized)) return service;
  }
  return null;
}
