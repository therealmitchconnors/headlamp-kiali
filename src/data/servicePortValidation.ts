import { isDnsLabel, isDnsSubdomain } from '../core/object';
import { ClusterScope, clusterScope } from '../core/scope';
import {
  SERVICE_PORT_LIMITS,
  ServicePortResource,
  servicePortResource,
  servicePortValidation,
  validateServicePortInput,
} from '../core/servicePortValidation';
import { CollectionRead, readCollection } from './collections';
import { loadMeshSnapshot, localManagedNamespaceScope } from './mesh';
import { observedResourceIdentity, readCluster, withDiagnosticDeadline } from './requests';

export interface ServicePortTarget {
  namespace: string;
  name: string;
  uid?: string;
}
export function validateServicePortTarget(target: ServicePortTarget) {
  if (
    !isDnsLabel(target.namespace) ||
    !isDnsSubdomain(target.name) ||
    (target.uid !== undefined &&
      (!target.uid || target.uid.length > 1024 || target.uid.trim() !== target.uid))
  )
    throw new Error('Service port checks require a valid namespace, name and optional linked UID');
}

function requireComplete<T>(source: CollectionRead<T>, name: string) {
  if (!source.complete || !source.resourceVersion)
    throw new Error(
      `${name}: ${
        source.error?.message ??
        'Complete versioned read required; limited or incomplete collection'
      }`
    );
  return source.resourceVersion;
}

export async function loadServicePortValidation(
  scope: ClusterScope,
  target: ServicePortTarget,
  logicalName: string | undefined,
  signal: AbortSignal
) {
  const capturedScope = clusterScope(scope.cluster);
  const capturedTarget = structuredClone(target);
  validateServicePortTarget(capturedTarget);
  return withDiagnosticDeadline(signal, 'Service port checks exceeded 15 seconds', async signal => {
    const path = `/api/v1/namespaces/${encodeURIComponent(
      capturedTarget.namespace
    )}/services/${encodeURIComponent(capturedTarget.name)}`;
    const readService = async () => {
      const value = await readCluster(capturedScope, path, signal);
      observedResourceIdentity(value, {
        kind: 'Service',
        apiVersion: 'v1',
        namespace: capturedTarget.namespace,
        name: capturedTarget.name,
      });
      const service = servicePortResource(value, 'Service');
      if (capturedTarget.uid !== undefined && service.uid !== capturedTarget.uid)
        throw new Error('Linked Service UID no longer matches the observed resource');
      return service;
    };
    const service = await readService();
    const exclusions = validateServicePortInput(service);
    if (exclusions.all) return { service, disabled: true as const };
    const mesh = await loadMeshSnapshot(capturedScope, signal);
    const managed = localManagedNamespaceScope(mesh, logicalName);
    if (
      managed.cluster !== capturedScope.cluster ||
      !managed.membership.some(value => value.namespace === service.namespace)
    )
      throw new Error('Selected Service is outside the declared local managed namespace scope');
    const pods: ServicePortResource[] = [];
    const sources: { namespace: string; resourceVersion: string; count: number }[] = [];
    let next = 0;
    const workers = Array.from({ length: Math.min(3, managed.membership.length) }, async () => {
      while (next < managed.membership.length) {
        signal.throwIfAborted();
        const namespace = managed.membership[next++].namespace;
        const source = await readCollection(
          capturedScope,
          {
            kind: 'Pod',
            apiVersion: 'v1',
            path: `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods`,
          },
          value => {
            const pod = servicePortResource(value, 'Pod');
            if (pod.namespace !== namespace)
              throw new Error('Pod namespace differs from the requested managed namespace');
            return pod;
          },
          signal
        );
        const resourceVersion = requireComplete(source, `Pods in ${namespace}`);
        if (pods.length + source.items.length > SERVICE_PORT_LIMITS.resources)
          throw new Error('Complete managed Pod pool exceeds the 1000-Pod limit');
        pods.push(...source.items);
        sources.push({
          namespace,
          resourceVersion,
          count: source.items.length,
        });
      }
    });
    const [deployments] = await Promise.all([
      readCollection(
        capturedScope,
        { kind: 'Deployment', apiVersion: 'apps/v1', path: '/apis/apps/v1/deployments' },
        value => servicePortResource(value, 'Deployment'),
        signal
      ),
      Promise.all(workers),
    ]);
    const deploymentVersion = requireComplete(deployments, 'Cluster-wide Deployments');
    const current = await readService();
    // Version equality binds labels, exclusions and all ports to the initial capture.
    if (
      current.uid !== service.uid ||
      current.resourceVersion !== service.resourceVersion ||
      JSON.stringify(current) !== JSON.stringify(service)
    )
      throw new Error('Selected Service changed while reading port validation evidence; retry');
    const result = servicePortValidation(
      service,
      pods,
      deployments.items,
      managed.controllerNamespaces
    );
    return {
      service,
      disabled: false as const,
      managed,
      sources,
      deploymentSource: {
        resourceVersion: deploymentVersion,
        count: deployments.items.length,
      },
      result,
    };
  });
}
