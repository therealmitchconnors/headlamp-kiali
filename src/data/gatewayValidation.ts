import { validateMeshClusterName } from '../core/config';
import {
  GatewayClassRegistry,
  GatewayClassSettings,
  resolveGatewayClassRegistry,
  validateGatewayClassSettings,
} from '../core/gatewayClassRegistry';
import { gatewayCollisionFields } from '../core/gatewayCollisions';
import {
  GatewayWorkload,
  GatewayWorkloadContext,
  gatewayWorkloadProjection,
} from '../core/gatewayWorkloads';
import { istioGatewayConflictFields } from '../core/istioGatewayConflicts';
import { decodeLabelSelector, isLabelKey, isLabelValue } from '../core/labels';
import { ControlPlaneObservation, controlPlaneObservation } from '../core/mesh';
import { isDnsLabel, isDnsSubdomain, isRecord } from '../core/object';
import type { ReferenceValidationContext, ValidationRecord } from '../core/referenceValidation';
import { ClusterScope, clusterScope, namespaceScope } from '../core/scope';
import { InitialValidation, initialValidation } from '../core/validation';
import { validationExclusions } from '../core/validationAnnotations';
import type { VirtualWorkloadGroup, VirtualWorkloadRecord } from '../core/virtualWorkloads';
import { workloadEntryLabels, workloadGroupEntrySelector } from '../core/workloadGroupEntries';
import { configurationDefinitions } from '../resources/registry';
import { CollectionRead, readCollection } from './collections';
import { discoverConfiguration } from './configuration';
import { CORRELATION_SOURCES, decodeCorrelationResource } from './correlation';
import { loadMeshSnapshot, localManagedNamespaceScope } from './mesh';
import {
  InvalidResponseError,
  observedResourceIdentity,
  readCluster,
  withDiagnosticDeadline,
} from './requests';

export interface CapturedGateway extends ValidationRecord {
  kind: 'Gateway';
  group: 'networking.istio.io' | 'gateway.networking.k8s.io';
  apiVersion: string;
  uid: string;
  resourceVersion: string;
  annotations: Record<string, string>;
  status?: unknown;
  generation?: number;
}
export interface ScopedGatewayValidation {
  target: CapturedGateway;
  scope?: ReturnType<typeof localManagedNamespaceScope>;
  controller?: { name: string; uid: string; resourceVersion: string; scopeToNamespace: boolean };
  workloads: GatewayWorkload[];
  registry?: GatewayClassRegistry;
  result: InitialValidation;
  excluded: boolean;
}
export interface GatewayValidationSettings {
  logicalName: string;
  gatewayClasses?: GatewayClassSettings;
  skipWildcardGatewayHosts?: boolean;
}
function boundedJSON(value: unknown) {
  if ((JSON.stringify(value)?.length ?? 0) > 262144)
    throw new InvalidResponseError('Gateway specification/status exceeds 256 KiB');
}
export function captureGateway(value: unknown): CapturedGateway {
  if (
    !isRecord(value) ||
    value.kind !== 'Gateway' ||
    typeof value.apiVersion !== 'string' ||
    !isRecord(value.metadata) ||
    !isDnsSubdomain(value.metadata.name) ||
    !isDnsLabel(value.metadata.namespace) ||
    !isRecord(value.spec)
  )
    throw new InvalidResponseError('Gateway checks require a versioned namespaced Gateway object');
  const group = value.apiVersion.split('/')[0];
  if (
    !['networking.istio.io', 'gateway.networking.k8s.io'].includes(group) ||
    value.apiVersion.split('/').length !== 2
  )
    throw new InvalidResponseError('Unsupported Gateway API group');
  const identity = observedResourceIdentity(value, {
    kind: 'Gateway',
    apiVersion: value.apiVersion,
    namespace: value.metadata.namespace,
    name: value.metadata.name,
  });
  const labels = workloadEntryLabels(value.metadata.labels);
  if (Object.entries(labels).some(([key, value]) => !isLabelKey(key) || !isLabelValue(value)))
    throw new InvalidResponseError('Malformed Gateway labels');
  const rawAnnotations = value.metadata.annotations ?? {};
  if (
    !isRecord(rawAnnotations) ||
    Object.keys(rawAnnotations).length > 256 ||
    Object.entries(rawAnnotations).some(
      ([key, annotation]) => key.length > 1024 || typeof annotation !== 'string'
    ) ||
    JSON.stringify(rawAnnotations).length > 262144
  )
    throw new InvalidResponseError('Malformed or oversized Gateway annotations');
  const annotations = Object.fromEntries(
    Object.entries(rawAnnotations).map(([key, annotation]) => [key, String(annotation)])
  );
  validationExclusions(annotations);
  boundedJSON(value.spec);
  boundedJSON(value.status);
  if (group === 'networking.istio.io') {
    istioGatewayConflictFields(value.spec);
    decodeLabelSelector({ matchLabels: value.spec.selector ?? {} });
  } else {
    if (!isDnsSubdomain(value.spec.gatewayClassName))
      throw new InvalidResponseError('Malformed Gateway class reference');
    gatewayCollisionFields(value.spec);
  }
  const generation = value.metadata.generation;
  if (
    generation !== undefined &&
    (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 1)
  )
    throw new InvalidResponseError('Malformed Gateway generation');
  return {
    kind: 'Gateway',
    group: group === 'networking.istio.io' ? group : 'gateway.networking.k8s.io',
    apiVersion: value.apiVersion,
    name: value.metadata.name,
    namespace: value.metadata.namespace,
    ...identity,
    labels,
    annotations,
    spec: structuredClone(value.spec),
    status: structuredClone(value.status),
    generation: typeof generation === 'number' ? generation : undefined,
  };
}
function sameGateway(expected: CapturedGateway, observed: CapturedGateway) {
  if (JSON.stringify(expected) !== JSON.stringify(observed))
    throw new Error(
      'Gateway identity, version, spec, status or metadata changed; reload before checking'
    );
}
function complete<T>(read: CollectionRead<T>, kind: string): T[] {
  if (!read.complete || !read.resourceVersion)
    throw new Error(
      `${kind} evidence is incomplete: ${read.error?.message ?? 'collection limit reached'}`
    );
  return read.items;
}
function definition(kind: string, group: string) {
  const found = configurationDefinitions.find(item => item.kind === kind && item.group === group);
  if (!found) throw new Error('Gateway validation resource definition is unavailable');
  return found;
}

export async function loadScopedGatewayValidation(
  requested: ClusterScope,
  resource: unknown,
  settings: GatewayValidationSettings,
  signal: AbortSignal
): Promise<ScopedGatewayValidation> {
  signal.throwIfAborted();
  const scope = clusterScope(requested.cluster);
  const target = captureGateway(resource);
  const capturedSettings = structuredClone(settings);
  validateMeshClusterName(capturedSettings.logicalName);
  const classes = validateGatewayClassSettings(
    capturedSettings.gatewayClasses ?? { classes: [], selector: {} }
  );
  if (
    capturedSettings.skipWildcardGatewayHosts !== undefined &&
    typeof capturedSettings.skipWildcardGatewayHosts !== 'boolean'
  )
    throw new Error('Gateway wildcard policy must be a boolean');
  if (validationExclusions(target.annotations).all)
    return {
      target,
      workloads: [],
      excluded: true,
      result: {
        findings: [],
        skipped: ['All Gateway checks are excluded by annotation; no evidence was read'],
        suppressed: 0,
        coverage: 'partial',
      },
    };
  return withDiagnosticDeadline(
    signal,
    'Scoped Gateway checks exceeded 15 seconds',
    async requestSignal => {
      const mesh = await loadMeshSnapshot(scope, requestSignal);
      if (mesh.cluster !== scope.cluster)
        throw new Error('Gateway mesh evidence belongs to a different cluster');
      const declared = localManagedNamespaceScope(mesh, capturedSettings.logicalName);
      const membership = declared.membership.find(item => item.namespace === target.namespace);
      if (!membership)
        throw new Error('Gateway namespace is outside the declared local managed namespace scope');
      const namespaces = declared.membership.map(item => item.namespace);
      const allowed = new Set(namespaces);
      let controller: ScopedGatewayValidation['controller'];
      if (target.group === 'networking.istio.io') {
        if (membership.controllers.length !== 1)
          throw new Error('Gateway namespace requires one unambiguous declared local controller');
        const observed = mesh.controllers.items.find(
          item => item.uid === membership.controllers[0].uid
        );
        if (
          !observed ||
          typeof observed.scopeGatewayToNamespace !== 'boolean' ||
          !observed.resourceVersion
        )
          throw new Error('Gateway namespace/controller environment evidence is unavailable');
        controller = {
          name: `${observed.namespace}/${observed.name}`,
          uid: observed.uid,
          resourceVersion: observed.resourceVersion,
          scopeToNamespace: observed.scopeGatewayToNamespace,
        };
      }
      const gatewayDefinition = definition('Gateway', target.group);
      const available = await discoverConfiguration(scope, gatewayDefinition, requestSignal);
      if (!available.available || available.apiVersion !== target.apiVersion)
        throw new Error('Selected Gateway API version is unavailable or changed');
      const native: ReturnType<typeof decodeCorrelationResource>[] = [];
      const observedControllers: ControlPlaneObservation[] = [];
      let groups: VirtualWorkloadGroup[] = [];
      let entries: VirtualWorkloadRecord[] = [];
      let gateways: CapturedGateway[] = [];
      let registry: GatewayClassRegistry | undefined;
      const jobs: (() => Promise<void>)[] = [
        async () => {
          let size = 0;
          const read = await readCollection(
            scope,
            {
              kind: 'Gateway',
              apiVersion: available.apiVersion,
              path: `/apis/${available.apiVersion}/gateways`,
            },
            value => {
              const current = captureGateway(value);
              size += JSON.stringify(current).length;
              if (size > 1048576) throw new InvalidResponseError('Gateway context exceeds 1 MiB');
              return current;
            },
            requestSignal
          );
          gateways = complete(read, 'Gateway').filter(item => allowed.has(item.namespace));
        },
      ];
      if (target.group === 'networking.istio.io') {
        const nativeSources = CORRELATION_SOURCES.filter(item =>
          ['Deployment', 'ReplicaSet', 'StatefulSet', 'DaemonSet', 'Pod'].includes(item.kind)
        );
        for (const source of nativeSources)
          jobs.push(async () => {
            const read = await readCollection(
              scope,
              {
                kind: source.kind,
                apiVersion: source.apiVersion,
                path: `${source.group ? `/apis/${source.apiVersion}` : '/api/v1'}/${source.plural}`,
              },
              value => {
                if (
                  !isRecord(value.metadata) ||
                  !isDnsLabel(value.metadata.namespace) ||
                  !isDnsSubdomain(value.metadata.name)
                )
                  throw new InvalidResponseError('Malformed Gateway workload identity');
                observedResourceIdentity(value, {
                  kind: source.kind,
                  apiVersion: source.apiVersion,
                  namespace: value.metadata.namespace,
                  name: value.metadata.name,
                });
                if (
                  ['Pod', 'ReplicaSet'].includes(source.kind) &&
                  Array.isArray(value.metadata.ownerReferences)
                )
                  for (const reference of value.metadata.ownerReferences) {
                    if (!isRecord(reference) || reference.controller !== true) continue;
                    const parent = nativeSources.find(item => item.kind === reference.kind);
                    if (parent && reference.apiVersion !== parent.apiVersion)
                      throw new InvalidResponseError(
                        'Gateway workload owner API version is unsupported; inclusion cannot be normalized'
                      );
                  }
                if (
                  source.kind === 'Deployment' &&
                  isRecord(value.metadata.labels) &&
                  value.metadata.labels.app === 'istiod'
                )
                  observedControllers.push(controlPlaneObservation(value));
                return decodeCorrelationResource(
                  value,
                  source,
                  namespaceScope(scope.cluster, value.metadata.namespace)
                );
              },
              requestSignal
            );
            native.push(
              ...complete(read, source.kind).filter(item => allowed.has(item.identity.namespace))
            );
          });
        for (const kind of ['WorkloadGroup', 'WorkloadEntry'] as const)
          jobs.push(async () => {
            const api = await discoverConfiguration(
              scope,
              definition(kind, 'networking.istio.io'),
              requestSignal
            );
            if (!api.available)
              throw new Error(
                `${kind} API is unavailable; complete default workload inclusion cannot be established`
              );
            const read = await readCollection(
              scope,
              {
                kind,
                apiVersion: api.apiVersion,
                path: `/apis/${api.apiVersion}/${
                  kind === 'WorkloadGroup' ? 'workloadgroups' : 'workloadentries'
                }`,
              },
              value => {
                if (
                  !isRecord(value.metadata) ||
                  !isDnsLabel(value.metadata.namespace) ||
                  !isDnsSubdomain(value.metadata.name) ||
                  !isRecord(value.spec)
                )
                  throw new InvalidResponseError(
                    'Malformed Gateway VM workload identity/specification'
                  );
                const identity = {
                  name: value.metadata.name,
                  namespace: value.metadata.namespace,
                  ...observedResourceIdentity(value, {
                    kind,
                    apiVersion: api.apiVersion,
                    namespace: value.metadata.namespace,
                    name: value.metadata.name,
                  }),
                };
                return {
                  ...identity,
                  labels: workloadEntryLabels(
                    kind === 'WorkloadGroup' ? value.metadata.labels : value.spec.labels
                  ),
                  selector:
                    kind === 'WorkloadGroup' ? workloadGroupEntrySelector(value.spec) ?? {} : {},
                };
              },
              requestSignal
            );
            const items = complete(read, kind).filter(item => allowed.has(item.namespace));
            if (kind === 'WorkloadGroup') groups = items;
            else entries = items;
          });
      } else
        jobs.push(async () => {
          if (classes.classes.length) {
            registry = resolveGatewayClassRegistry(classes);
            return;
          }
          const api = await discoverConfiguration(
            scope,
            definition('GatewayClass', target.group),
            requestSignal
          );
          if (!api.available) throw new Error('GatewayClass discovery is unavailable');
          const read = await readCollection(
            scope,
            {
              kind: 'GatewayClass',
              apiVersion: api.apiVersion,
              path: `/apis/${api.apiVersion}/gatewayclasses`,
            },
            value => {
              const metadata = value.metadata;
              if (
                !isRecord(metadata) ||
                !isDnsSubdomain(metadata.name) ||
                (metadata.namespace !== undefined && metadata.namespace !== '') ||
                ['uid', 'resourceVersion'].some(field => {
                  const text = metadata[field];
                  return (
                    typeof text !== 'string' || !text || text.trim() !== text || text.length > 1024
                  );
                }) ||
                !isRecord(value.spec) ||
                typeof value.spec.controllerName !== 'string' ||
                !value.spec.controllerName ||
                value.spec.controllerName.length > 1024
              )
                throw new InvalidResponseError('Malformed cluster-scoped GatewayClass evidence');
              return {
                name: metadata.name,
                namespace: '',
                uid: String(metadata.uid),
                labels: workloadEntryLabels(metadata.labels),
                spec: value.spec,
              };
            },
            requestSignal
          );
          registry = resolveGatewayClassRegistry(classes, {
            complete: true,
            items: complete(read, 'GatewayClass'),
          });
        });
      let next = 0;
      async function worker() {
        while (next < jobs.length) {
          requestSignal.throwIfAborted();
          await jobs[next++]();
        }
      }
      await Promise.all(Array.from({ length: 3 }, () => worker()));
      requestSignal.throwIfAborted();
      const listed = gateways.find(
        item => item.name === target.name && item.namespace === target.namespace
      );
      if (!listed)
        throw new Error('Selected Gateway is missing from complete declared-scope evidence');
      sameGateway(target, listed);
      if (controller) {
        for (const original of mesh.controllers.items) {
          const currentController = observedControllers.find(item => item.uid === original.uid);
          if (
            !original.resourceVersion ||
            JSON.stringify(original) !== JSON.stringify(currentController)
          )
            throw new Error(
              'Gateway controller identity, version, environment or configuration provenance changed during capture'
            );
        }
      }
      const workloads =
        target.group === 'networking.istio.io'
          ? gatewayWorkloadProjection(scope.cluster, namespaces, native, groups, entries)
          : [];
      const latest = captureGateway(
        await readCluster(
          scope,
          `/apis/${target.apiVersion}/namespaces/${encodeURIComponent(
            target.namespace
          )}/gateways/${encodeURIComponent(target.name)}`,
          requestSignal
        )
      );
      sameGateway(target, latest);
      const context: ReferenceValidationContext = {
        cluster: scope.cluster,
        identityDomain: null,
        namespaces: {
          complete: true,
          items: mesh.namespaces.items.map(item => ({ ...item, namespace: '', spec: {} })),
        },
        destinationRules: { complete: false, items: [] },
        sidecars: { complete: false, items: [] },
        ...(target.group === 'networking.istio.io'
          ? {
              istioGateways: { complete: true, items: gateways },
              skipWildcardGatewayHosts: capturedSettings.skipWildcardGatewayHosts ?? false,
            }
          : { gateways: { complete: true, items: gateways }, gatewayClassRegistry: registry }),
      };
      const gatewayWorkloads: GatewayWorkloadContext | undefined = controller
        ? {
            complete: true,
            namespaces,
            scopeToNamespace: controller.scopeToNamespace,
            items: workloads,
          }
        : undefined;
      return {
        target,
        scope: declared,
        controller,
        workloads,
        registry,
        excluded: false,
        result: initialValidation({
          cluster: scope.cluster,
          namespace: target.namespace,
          kind: target.kind,
          group: target.group,
          spec: target.spec,
          status: target.status,
          generation: target.generation,
          owner: { name: target.name, uid: target.uid },
          annotations: target.annotations,
          workloads: [],
          complete: false,
          context,
          gatewayWorkloads,
        }),
      };
    }
  );
}
