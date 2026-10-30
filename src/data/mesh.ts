import {
  ControlPlaneObservation,
  controlPlaneObservation,
  InjectorFields,
  injectorFields,
  mergeMeshFields,
  MeshConfigFields,
  meshConfigFields,
  namespaceAssociations,
  namespaceDiscovery,
  NamespaceMeshConfiguration,
  NamespaceObservation,
  namespaceObservation,
  resolvedMeshRoot,
  revisionConfigMapName,
  RevisionTag,
  revisionTag,
} from '../core/mesh';
import { namespaceRevisionSelection } from '../core/namespaceRevision';
import { isDnsSubdomain, isRecord } from '../core/object';
import { ClusterScope, clusterScope } from '../core/scope';
import { CollectionRead, readCollection } from './collections';
import {
  InvalidResponseError,
  readCluster,
  ReadFailure,
  readFailure,
  withDiagnosticDeadline,
} from './requests';

export type ConfigurationRead<T> =
  | { status: 'ready'; name: string; value: T }
  | { status: 'error'; name: string; error: ReadFailure }
  | { status: 'limited'; name: string };
export interface MeshControlPlane {
  controller: ControlPlaneObservation;
  mesh: ConfigurationRead<MeshConfigFields>;
  injector: ConfigurationRead<InjectorFields>;
  shared?: ConfigurationRead<MeshConfigFields>;
  effective?:
    | { status: 'ready'; value: MeshConfigFields; sharedAbsent: boolean }
    | { status: 'unavailable'; message: string };
}
export interface MeshSnapshot {
  cluster: string;
  namespaces: CollectionRead<NamespaceObservation>;
  controllers: CollectionRead<ControlPlaneObservation>;
  tags: CollectionRead<RevisionTag>;
  controlPlanes: MeshControlPlane[];
}

export function namespaceMeshConfiguration(
  snapshot: MeshSnapshot,
  namespace: string
): NamespaceMeshConfiguration {
  const unavailable = (message: string): NamespaceMeshConfiguration => ({
    status: 'unavailable',
    message: `${namespace}: ${message}`,
  });
  if (!snapshot.namespaces.complete || !snapshot.controllers.complete || !snapshot.tags.complete)
    return unavailable('Namespace, controller or revision-tag discovery is incomplete');
  const observed = snapshot.namespaces.items.find(item => item.name === namespace);
  if (!observed) return unavailable('Namespace was not returned by mesh discovery');
  const revision = namespaceRevisionSelection(observed.labels);
  if (revision.ok === false) return unavailable(revision.message);
  const association = namespaceAssociations(
    [observed],
    snapshot.controllers.items,
    snapshot.tags.items,
    true
  )[0];
  if (association.mode === 'conflicting' || association.mode === 'unknown')
    return unavailable('Namespace injection labels cannot select an unambiguous controller');
  const candidates = snapshot.controlPlanes.filter(
    plane =>
      plane.controller.namespace === namespace ||
      (plane.effective?.status === 'ready' && plane.effective.value.rootNamespace === namespace) ||
      (revision.basis !== 'maistra-member' &&
        association.controllers.some(controller => controller.uid === plane.controller.uid))
  );
  if (candidates.length !== 1)
    return unavailable(
      revision.basis === 'maistra-member'
        ? 'Maistra membership cannot be resolved from local Istiod revision-label hints'
        : 'A unique local controller configuration could not be resolved'
    );
  const plane = candidates[0];
  if (plane.effective?.status !== 'ready')
    return unavailable(
      plane.effective?.message ?? 'Controller configuration sources are unresolved'
    );
  const discovery = namespaceDiscovery(observed, plane.controller.namespace, plane.effective.value);
  if (discovery.status !== 'included') return unavailable(discovery.message);
  return {
    status: 'ready',
    controller: `${plane.controller.namespace}/${plane.controller.name}`,
    fields: plane.effective.value,
    discovery: discovery.basis,
    root: resolvedMeshRoot(plane.effective.value, plane.controller.namespace),
  };
}

async function configMap<T>(
  scope: ClusterScope,
  namespace: string,
  name: string,
  field: string,
  parse: (value: unknown) => T,
  signal: AbortSignal
): Promise<ConfigurationRead<T>> {
  try {
    const response = await readCluster(
      scope,
      `/api/v1/namespaces/${encodeURIComponent(namespace)}/configmaps/${encodeURIComponent(name)}`,
      signal
    );
    if (
      !isRecord(response) ||
      response.kind !== 'ConfigMap' ||
      response.apiVersion !== 'v1' ||
      !isRecord(response.metadata) ||
      response.metadata.name !== name ||
      response.metadata.namespace !== namespace ||
      !isRecord(response.data)
    )
      throw new InvalidResponseError('ConfigMap response does not match the requested identity');
    try {
      return { status: 'ready', name, value: parse(response.data[field]) };
    } catch (error) {
      throw new InvalidResponseError(
        error instanceof Error ? error.message : 'Invalid mesh configuration'
      );
    }
  } catch (error) {
    if (signal.aborted) throw error;
    return { status: 'error', name, error: readFailure(error) };
  }
}

export async function loadMeshSnapshot(
  scope: ClusterScope,
  signal: AbortSignal
): Promise<MeshSnapshot> {
  signal.throwIfAborted();
  const captured = clusterScope(scope.cluster);
  return withDiagnosticDeadline(signal, 'Mesh discovery exceeded 15 seconds', requestSignal =>
    readMeshSnapshot(captured, requestSignal)
  );
}

async function readMeshSnapshot(scope: ClusterScope, signal: AbortSignal): Promise<MeshSnapshot> {
  const [namespaces, controllers, tags] = await Promise.all([
    readCollection(
      scope,
      { path: '/api/v1/namespaces', apiVersion: 'v1', kind: 'Namespace' },
      namespaceObservation,
      signal
    ),
    readCollection(
      scope,
      {
        path: '/apis/apps/v1/deployments',
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        pageSize: 50,
        query: { labelSelector: 'app=istiod' },
      },
      controlPlaneObservation,
      signal
    ),
    readCollection(
      scope,
      {
        path: '/apis/admissionregistration.k8s.io/v1/mutatingwebhookconfigurations',
        apiVersion: 'admissionregistration.k8s.io/v1',
        kind: 'MutatingWebhookConfiguration',
        pageSize: 50,
        query: { labelSelector: 'istio.io/tag' },
      },
      revisionTag,
      signal
    ),
  ]);
  const ordered = [...controllers.items].sort((a, b) =>
    `${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`)
  );
  const controlPlanes = ordered.map((controller): MeshControlPlane => {
    try {
      return {
        controller,
        mesh: { status: 'limited', name: revisionConfigMapName('istio', controller.revision) },
        injector: {
          status: 'limited',
          name: revisionConfigMapName('istio-sidecar-injector', controller.revision),
        },
      };
    } catch (error) {
      const failure = readFailure(
        new InvalidResponseError(
          error instanceof Error ? error.message : 'Invalid revision configuration identity'
        )
      );
      return {
        controller,
        mesh: { status: 'error', name: '', error: failure },
        injector: { status: 'error', name: '', error: failure },
      };
    }
  });
  const meshReads = new Map<string, Promise<ConfigurationRead<MeshConfigFields>>>();
  const injectorReads = new Map<string, Promise<ConfigurationRead<InjectorFields>>>();
  for (const plane of controlPlanes) {
    const shared = plane.controller.sharedMeshConfig;
    if (!shared) continue;
    plane.shared =
      !isDnsSubdomain(shared) || plane.controller.managesExternal !== false
        ? {
            status: 'error',
            name: '',
            error: {
              kind: 'unavailable',
              message: !isDnsSubdomain(shared)
                ? 'Invalid shared ConfigMap name'
                : 'Shared configuration requires an explicitly mapped external configuration cluster',
            },
          }
        : { status: 'limited', name: shared };
  }
  const tasks = controlPlanes.slice(0, 20).flatMap(plane => [
    async () => {
      if (plane.mesh.status === 'error') return;
      const key = `${plane.controller.namespace}/${plane.mesh.name}`;
      if (!meshReads.has(key))
        meshReads.set(
          key,
          configMap(
            scope,
            plane.controller.namespace,
            plane.mesh.name,
            'mesh',
            meshConfigFields,
            signal
          )
        );
      plane.mesh = await meshReads.get(key)!;
    },
    async () => {
      if (plane.injector.status === 'error') return;
      const key = `${plane.controller.namespace}/${plane.injector.name}`;
      if (!injectorReads.has(key))
        injectorReads.set(
          key,
          configMap(
            scope,
            plane.controller.namespace,
            plane.injector.name,
            'values',
            injectorFields,
            signal
          )
        );
      plane.injector = await injectorReads.get(key)!;
    },
    async () => {
      if (!plane.shared || plane.shared.status !== 'limited') return;
      const key = `${plane.controller.namespace}/${plane.shared.name}`;
      if (!meshReads.has(key))
        meshReads.set(
          key,
          configMap(
            scope,
            plane.controller.namespace,
            plane.shared.name,
            'mesh',
            meshConfigFields,
            signal
          )
        );
      plane.shared = await meshReads.get(key)!;
    },
  ]);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      signal.throwIfAborted();
      await tasks[next++]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, tasks.length) }, worker));
  for (const plane of controlPlanes) {
    const sharedAbsent =
      plane.shared?.status === 'error' && plane.shared.error.kind === 'not-found';
    if (
      plane.controller.effectiveConfigBlocked ||
      plane.mesh.status !== 'ready' ||
      (plane.shared && plane.shared.status !== 'ready' && !sharedAbsent)
    ) {
      plane.effective = {
        status: 'unavailable',
        message:
          'Selected merged fields are unavailable because configuration sources or overrides are unresolved',
      };
    } else {
      plane.effective = {
        status: 'ready',
        sharedAbsent,
        value:
          plane.shared?.status === 'ready'
            ? mergeMeshFields(plane.mesh.value, plane.shared.value)
            : plane.mesh.value,
      };
    }
  }
  return { cluster: scope.cluster, namespaces, controllers, tags, controlPlanes };
}
