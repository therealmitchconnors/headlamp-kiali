import { isDnsLabel } from './object';

export interface ClusterScope {
  readonly cluster: string;
}

export interface NamespaceScope extends ClusterScope {
  readonly namespace: string;
}

export function namespaceScope(cluster: string, namespace: string): NamespaceScope {
  if (!isDnsLabel(namespace)) throw new Error('A valid namespace must be selected');
  return Object.freeze({ ...clusterScope(cluster), namespace });
}
export interface ResourceIdentity extends ClusterScope {
  readonly group: string;
  readonly kind: string;
  readonly namespace?: string;
  readonly name: string;
  readonly uid?: string;
}

export function clusterScope(cluster: string): ClusterScope {
  if (!cluster.trim()) {
    throw new Error('A cluster must be selected');
  }
  return Object.freeze({ cluster });
}

export function resourceKey(resource: ResourceIdentity): string {
  return JSON.stringify([
    resource.cluster,
    resource.group,
    resource.kind,
    resource.namespace ?? '',
    resource.name,
    resource.uid ?? '',
  ]);
}
