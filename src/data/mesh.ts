import {
  ControlPlaneObservation,
  controlPlaneObservation,
  emptyMeshNetworks,
  InjectorFields,
  injectorFields,
  mergeMeshFields,
  MeshConfigFields,
  meshConfigFields,
  MeshConfigMapSource,
  MeshConfigurationSources,
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
import { localManagedNamespaceProjection } from '../core/meshMembership';
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
  | { status: 'ready'; name: string; value: T; source?: MeshConfigMapSource }
  | { status: 'error'; name: string; error: ReadFailure }
  | { status: 'limited'; name: string };
export interface MeshControlPlane {
  controller: ControlPlaneObservation;
  mesh: ConfigurationRead<MeshConfigFields>;
  injector: ConfigurationRead<InjectorFields>;
  shared?: ConfigurationRead<MeshConfigFields>;
  networks?: ConfigurationRead<'absent-key' | 'empty'>;
  effective?:
    | {
        status: 'ready';
        value: MeshConfigFields;
        sharedAbsent: boolean;
        sources?: MeshConfigurationSources;
      }
    | { status: 'unavailable'; message: string };
}
export interface MeshSnapshot {
  cluster: string;
  namespaces: CollectionRead<NamespaceObservation>;
  controllers: CollectionRead<ControlPlaneObservation>;
  tags: CollectionRead<RevisionTag>;
  controlPlanes: MeshControlPlane[];
}

export function localManagedNamespaceScope(
  snapshot: MeshSnapshot,
  logicalName: string | undefined
) {
  if (logicalName === undefined)
    throw new Error(
      'Configure an explicit logical mesh cluster name before evaluating managed namespace scope'
    );
  if (
    [snapshot.namespaces, snapshot.controllers, snapshot.tags].some(
      source => !source.complete || !source.resourceVersion
    )
  )
    throw new Error(
      'Complete versioned namespace, controller and revision-tag reads are required for managed scope'
    );
  if (snapshot.controlPlanes.length !== snapshot.controllers.items.length)
    throw new Error('Managed scope requires configuration evidence for every captured controller');
  const controllers = snapshot.controllers.items.map(controller => {
    const plane = snapshot.controlPlanes.find(plane => plane.controller.uid === controller.uid);
    if (
      plane?.effective?.status !== 'ready' ||
      plane.controller.name !== controller.name ||
      plane.controller.namespace !== controller.namespace
    )
      throw new Error(
        'Managed scope requires resolved configuration for every captured controller'
      );
    return { controller, fields: plane.effective.value };
  });
  return {
    cluster: snapshot.cluster,
    configurationSources: snapshot.controlPlanes.map(plane => ({
      controller: `${plane.controller.namespace}/${plane.controller.name}`,
      sources: structuredClone(
        plane.effective?.status === 'ready' ? plane.effective.sources : undefined
      ),
    })),
    ...localManagedNamespaceProjection(
      logicalName,
      snapshot.namespaces.items,
      controllers,
      snapshot.tags.items
    ),
  };
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
    fields: structuredClone(plane.effective.value),
    sources: structuredClone(plane.effective.sources),
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
  signal: AbortSignal,
  validateData?: (data: Record<string, unknown>) => void
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
      (response.data !== undefined && response.data !== null && !isRecord(response.data))
    )
      throw new InvalidResponseError('ConfigMap response does not match the requested identity');
    const data = isRecord(response.data) ? response.data : {};
    try {
      validateData?.(data);
      return {
        status: 'ready',
        name,
        value: parse(data[field]),
        source: {
          cluster: scope.cluster,
          namespace,
          name,
          key: field,
          uid: typeof response.metadata.uid === 'string' ? response.metadata.uid : undefined,
          resourceVersion:
            typeof response.metadata.resourceVersion === 'string'
              ? response.metadata.resourceVersion
              : undefined,
        },
      };
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
        mesh: {
          status: 'limited',
          name:
            controller.meshConfigSource?.name ??
            revisionConfigMapName('istio', controller.revision),
        },
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
  const networksReads = new Map<string, Promise<ConfigurationRead<'absent-key' | 'empty'>>>();
  for (const plane of controlPlanes) {
    if (plane.controller.meshNetworksSource)
      plane.networks = { status: 'limited', name: plane.controller.meshNetworksSource.name };
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
      const field = plane.controller.meshConfigSource?.key ?? 'mesh';
      const key = JSON.stringify([plane.controller.namespace, plane.mesh.name, field, false]);
      if (!meshReads.has(key))
        meshReads.set(
          key,
          configMap(
            scope,
            plane.controller.namespace,
            plane.mesh.name,
            field,
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
      const checkNetworks = plane.controller.meshConfigSource?.kind === 'mounted';
      const key = JSON.stringify([
        plane.controller.namespace,
        plane.shared.name,
        'mesh',
        checkNetworks,
      ]);
      if (!meshReads.has(key))
        meshReads.set(
          key,
          configMap(
            scope,
            plane.controller.namespace,
            plane.shared.name,
            'mesh',
            meshConfigFields,
            signal,
            checkNetworks ? data => emptyMeshNetworks(data.meshNetworks) : undefined
          )
        );
      plane.shared = await meshReads.get(key)!;
    },
    async () => {
      const source = plane.controller.meshNetworksSource;
      if (!source || !plane.networks) return;
      const key = JSON.stringify([plane.controller.namespace, source.name, source.key]);
      if (!networksReads.has(key))
        networksReads.set(
          key,
          configMap(
            scope,
            plane.controller.namespace,
            source.name,
            source.key,
            emptyMeshNetworks,
            signal
          )
        );
      plane.networks = await networksReads.get(key)!;
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
  const captureFailures = new Map<MeshControlPlane, string>();
  const verificationReads = new Map<string, Promise<ConfigurationRead<unknown>>>();
  const versioned = (source: Pick<MeshConfigMapSource, 'uid' | 'resourceVersion'> | undefined) =>
    source &&
    [source.uid, source.resourceVersion].every(
      value =>
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= 1024 &&
        value.trim() === value
    );
  async function verifyRead<T>(
    plane: MeshControlPlane,
    original: ConfigurationRead<T>,
    key: string,
    parse: (value: unknown) => T,
    checkNetworks = false
  ) {
    const absent = original.status === 'error' && original.error.kind === 'not-found';
    if (!absent && (original.status !== 'ready' || !versioned(original.source)))
      throw new Error('Mounted mesh configuration requires versioned ConfigMap sources');
    const identity = JSON.stringify([
      plane.controller.namespace,
      original.name,
      key,
      parse === emptyMeshNetworks,
      checkNetworks,
    ]);
    if (!verificationReads.has(identity))
      verificationReads.set(
        identity,
        configMap(
          scope,
          plane.controller.namespace,
          original.name,
          key,
          parse,
          signal,
          checkNetworks ? data => emptyMeshNetworks(data.meshNetworks) : undefined
        )
      );
    const current = await verificationReads.get(identity)!;
    if (
      absent
        ? current.status !== 'error' || current.error.kind !== 'not-found'
        : JSON.stringify(original) !== JSON.stringify(current)
    )
      throw new Error('Mesh configuration source changed or became unavailable during capture');
  }
  tasks.push(
    ...controlPlanes.slice(0, 20).map(plane => async () => {
      if (
        !plane.controller.meshConfigSource?.path ||
        plane.controller.effectiveConfigBlocked ||
        plane.mesh.status !== 'ready'
      )
        return;
      try {
        if (
          !namespaces.complete ||
          !controllers.complete ||
          !tags.complete ||
          !versioned(plane.controller)
        )
          throw new Error('Mounted mesh configuration requires complete versioned discovery');
        await verifyRead(
          plane,
          plane.mesh,
          plane.controller.meshConfigSource.key,
          meshConfigFields
        );
        if (plane.shared)
          await verifyRead(
            plane,
            plane.shared,
            'mesh',
            meshConfigFields,
            plane.controller.meshConfigSource.kind === 'mounted'
          );
        if (plane.networks && plane.controller.meshNetworksSource)
          await verifyRead(
            plane,
            plane.networks,
            plane.controller.meshNetworksSource.key,
            emptyMeshNetworks
          );
        const response = await readCluster(
          scope,
          `/apis/apps/v1/namespaces/${encodeURIComponent(
            plane.controller.namespace
          )}/deployments/${encodeURIComponent(plane.controller.name)}`,
          signal
        );
        if (
          !isRecord(response) ||
          response.apiVersion !== 'apps/v1' ||
          response.kind !== 'Deployment' ||
          JSON.stringify(controlPlaneObservation(response)) !== JSON.stringify(plane.controller)
        )
          throw new Error('Controller configuration provenance changed during capture');
      } catch (error) {
        if (signal.aborted) throw error;
        captureFailures.set(
          plane,
          error instanceof Error ? error.message : 'Mounted configuration capture is unavailable'
        );
      }
    })
  );
  await Promise.all(Array.from({ length: Math.min(3, tasks.length - next) }, worker));
  signal.throwIfAborted();
  for (const plane of controlPlanes) {
    const sharedAbsent =
      plane.shared?.status === 'error' && plane.shared.error.kind === 'not-found';
    if (
      plane.controller.effectiveConfigBlocked ||
      captureFailures.has(plane) ||
      plane.mesh.status !== 'ready' ||
      (plane.networks && plane.networks.status !== 'ready') ||
      (plane.shared && plane.shared.status !== 'ready' && !sharedAbsent)
    ) {
      plane.effective = {
        status: 'unavailable',
        message:
          captureFailures.get(plane) ??
          'Selected merged fields are unavailable because configuration sources or overrides are unresolved',
      };
    } else {
      plane.effective = {
        status: 'ready',
        sharedAbsent,
        sources: plane.mesh.source
          ? {
              local: {
                ...plane.mesh.source,
                kind: plane.controller.meshConfigSource?.kind ?? 'standard',
                path: plane.controller.meshConfigSource?.path,
              },
              shared:
                plane.shared?.status === 'ready' && plane.shared.source
                  ? { ...plane.shared.source, status: 'ready' }
                  : sharedAbsent && plane.shared
                  ? {
                      cluster: scope.cluster,
                      namespace: plane.controller.namespace,
                      name: plane.shared.name,
                      key: 'mesh',
                      status: 'not-found',
                    }
                  : undefined,
              networks:
                plane.networks?.status === 'ready' &&
                plane.networks.source &&
                plane.controller.meshNetworksSource
                  ? {
                      ...plane.networks.source,
                      path: plane.controller.meshNetworksSource.path,
                      content: plane.networks.value,
                    }
                  : undefined,
            }
          : undefined,
        value:
          plane.shared?.status === 'ready'
            ? mergeMeshFields(plane.mesh.value, plane.shared.value)
            : structuredClone(plane.mesh.value),
      };
    }
  }
  return { cluster: scope.cluster, namespaces, controllers, tags, controlPlanes };
}
