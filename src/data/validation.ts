import { authorizationHostsNeedContext } from '../core/authorizationHosts';
import { destinationRuleNeedsPeerPolicies } from '../core/destinationRulePolicyValidation';
import {
  gatewayClassNeedsRegistry,
  GatewayClassSettings,
  resolveGatewayClassRegistry,
  validateGatewayClassSettings,
} from '../core/gatewayClassRegistry';
import { isDnsLabel, isDnsSubdomain, isRecord } from '../core/object';
import { peerAuthenticationNeedsContext } from '../core/peerAuthenticationValidation';
import { peerSelectorlessNeedsContext } from '../core/peerSelectorConflicts';
import {
  ReferenceValidationContext,
  referenceValidationSources,
  ValidationRecord,
  ValidationSourceKey,
} from '../core/referenceValidation';
import { ClusterScope, clusterScope } from '../core/scope';
import { sidecarNeedsRegistry } from '../core/sidecarEgressValidation';
import { sidecarNeedsMeshConfiguration } from '../core/sidecarValidation';
import { virtualServiceNeedsRegistry } from '../core/virtualServiceRegistry';
import { configurationDefinitions } from '../resources/registry';
import { CollectionRead, readCollection } from './collections';
import { discoverConfiguration } from './configuration';
import { loadMeshSnapshot, namespaceMeshConfiguration } from './mesh';
import { InvalidResponseError, readFailure, withDiagnosticDeadline } from './requests';

export interface ValidationSource extends CollectionRead<ValidationRecord> {
  key: ValidationSourceKey;
  namespace?: string;
}
export interface ValidationSnapshot {
  context: ReferenceValidationContext;
  sources: ValidationSource[];
}

async function readSource(
  scope: ClusterScope,
  key: ValidationSourceKey,
  signal: AbortSignal,
  namespace?: string
): Promise<ValidationSource> {
  const snapshot: ValidationSource = { key, items: [], complete: false };
  try {
    const kind = {
      namespaces: 'Namespace',
      destinationRules: 'DestinationRule',
      serviceEntries: 'ServiceEntry',
      virtualServices: 'VirtualService',
      sidecars: 'Sidecar',
      gateways: 'Gateway',
      gatewayClasses: 'GatewayClass',
      istioGateways: 'Gateway',
      workloadGroups: 'WorkloadGroup',
      services: 'Service',
      peerAuthentications: 'PeerAuthentication',
      referenceGrants: 'ReferenceGrant',
    }[key];
    let apiVersion = 'v1';
    let namespaced = key !== 'namespaces';
    const sourceNamespace = key === 'workloadGroups' ? namespace : undefined;
    if (key === 'workloadGroups' && !isDnsLabel(sourceNamespace))
      throw new Error('A namespace is required for WorkloadGroup label checks');
    if (sourceNamespace) snapshot.namespace = sourceNamespace;
    let path = key === 'services' ? '/api/v1/services' : '/api/v1/namespaces';
    if (key !== 'namespaces' && key !== 'services') {
      const group =
        key === 'gateways' || key === 'gatewayClasses' || key === 'referenceGrants'
          ? 'gateway.networking.k8s.io'
          : key === 'peerAuthentications'
          ? 'security.istio.io'
          : 'networking.istio.io';
      const definition = configurationDefinitions.find(
        definition => definition.kind === kind && definition.group === group
      );
      if (!definition) throw new Error('Missing configuration model for validation');
      namespaced = definition.resourceClass.isNamespaced;
      const availability = await discoverConfiguration(scope, definition, signal);
      if (availability.available === false)
        throw new Error(`${kind} API unavailable: ${availability.reason}`);
      apiVersion = availability.apiVersion;
      path = `/apis/${apiVersion}${
        sourceNamespace ? `/namespaces/${encodeURIComponent(sourceNamespace)}` : ''
      }/${definition.plural}`;
    }
    const result = await readCollection(
      scope,
      { kind, apiVersion, path },
      (item): ValidationRecord => {
        if (
          !isRecord(item) ||
          (item.kind !== undefined && item.kind !== kind) ||
          (item.apiVersion !== undefined && item.apiVersion !== apiVersion) ||
          !isRecord(item.metadata) ||
          !isDnsSubdomain(item.metadata.name) ||
          typeof item.metadata.uid !== 'string' ||
          !item.metadata.uid ||
          (namespaced && !isDnsLabel(item.metadata.namespace)) ||
          (!namespaced &&
            item.metadata.namespace !== undefined &&
            item.metadata.namespace !== '') ||
          (sourceNamespace !== undefined && item.metadata.namespace !== sourceNamespace) ||
          (kind === 'Namespace' && !isDnsLabel(item.metadata.name)) ||
          !isRecord(item.spec ?? {})
        )
          throw new InvalidResponseError(`Malformed ${kind} in validation snapshot`);
        const labels = item.metadata.labels ?? {};
        if (!isRecord(labels) || Object.values(labels).some(value => typeof value !== 'string'))
          throw new InvalidResponseError('Invalid namespace or configuration labels');
        const spec = isRecord(item.spec) ? item.spec : {};
        let exportToAnnotation: string | undefined;
        if (kind === 'Service' && item.metadata.annotations !== undefined) {
          if (!isRecord(item.metadata.annotations))
            throw new InvalidResponseError('Invalid Service annotations');
          const value = item.metadata.annotations['networking.istio.io/exportTo'];
          if (value !== undefined) {
            if (typeof value !== 'string')
              throw new InvalidResponseError('Invalid Service export annotation');
            exportToAnnotation = value;
          }
        }
        if (
          kind === 'DestinationRule' &&
          (typeof spec.host !== 'string' ||
            (spec.subsets !== undefined &&
              (!Array.isArray(spec.subsets) ||
                spec.subsets.some(subset => !isRecord(subset) || typeof subset.name !== 'string'))))
        )
          throw new InvalidResponseError('Invalid DestinationRule host or subsets');
        return {
          name: item.metadata.name,
          uid: item.metadata.uid,
          namespace: typeof item.metadata.namespace === 'string' ? item.metadata.namespace : '',
          labels: Object.fromEntries(
            Object.entries(labels).map(([key, value]) => [key, String(value)])
          ),
          spec,
          ...(exportToAnnotation === undefined ? {} : { exportToAnnotation }),
        };
      },
      signal
    );
    return { ...snapshot, ...result };
  } catch (error) {
    if (signal.aborted) throw error;
    return { ...snapshot, error: readFailure(error) };
  }
}

export async function loadValidationSnapshot(
  scope: ClusterScope,
  kind: string,
  group: string,
  spec: unknown,
  identityDomain: string | null,
  signal: AbortSignal,
  namespace?: string,
  gatewayClasses?: GatewayClassSettings
): Promise<ValidationSnapshot> {
  signal.throwIfAborted();
  const capturedScope = clusterScope(scope.cluster);
  const capturedSpec = structuredClone(spec);
  const capturedClasses =
    gatewayClasses === undefined ? undefined : validateGatewayClassSettings(gatewayClasses);
  return withDiagnosticDeadline(signal, 'Configuration checks exceeded 15 seconds', requestSignal =>
    readValidationSnapshot(
      capturedScope,
      kind,
      group,
      capturedSpec,
      identityDomain,
      requestSignal,
      namespace,
      capturedClasses
    )
  );
}

async function readValidationSnapshot(
  scope: ClusterScope,
  kind: string,
  group: string,
  spec: unknown,
  identityDomain: string | null,
  signal: AbortSignal,
  namespace?: string,
  gatewayClasses?: GatewayClassSettings
): Promise<ValidationSnapshot> {
  signal.throwIfAborted();
  if (namespace !== undefined && namespace !== '' && !isDnsLabel(namespace))
    throw new Error('Validation requires a valid namespace');
  const classSettings = validateGatewayClassSettings(
    gatewayClasses ?? { classes: [], selector: {} }
  );
  const classesRequested = gatewayClassNeedsRegistry(kind, group, spec);
  let keys = referenceValidationSources(kind, group, spec, identityDomain, namespace).filter(
    key => key !== 'gatewayClasses' || !classSettings.classes.length
  );
  const registryRequested =
    sidecarNeedsRegistry(kind, group, spec, identityDomain) ||
    virtualServiceNeedsRegistry(kind, group, spec, identityDomain) ||
    authorizationHostsNeedContext(kind, group, spec, namespace ?? '');
  const rootSelectorRequested = sidecarNeedsMeshConfiguration(kind, group, spec);
  const peerRequested = peerAuthenticationNeedsContext(kind, group, spec);
  const peerSelectorsRequested = peerSelectorlessNeedsContext(kind, group, spec);
  const destinationPeerRequested = destinationRuleNeedsPeerPolicies(
    kind,
    group,
    namespace ?? '',
    spec,
    identityDomain
  );
  const sources: ValidationSource[] = [];
  if (
    kind === 'AuthorizationPolicy' &&
    group === 'security.istio.io' &&
    keys.includes('namespaces')
  ) {
    const source = await readSource(scope, 'namespaces', signal);
    sources.push(source);
    keys = keys.filter(key => key !== 'namespaces');
    if (
      !source.complete ||
      !authorizationHostsNeedContext(
        kind,
        group,
        spec,
        namespace ?? '',
        source.items.map(item => item.name)
      )
    )
      keys = [];
  }
  const offset = sources.length;
  let next = 0;
  async function worker() {
    while (next < keys.length) {
      const index = next++;
      signal.throwIfAborted();
      sources[offset + index] = await readSource(scope, keys[index], signal, namespace);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, keys.length) }, worker));
  const empty = { items: [], complete: false };
  const snapshot: ValidationSnapshot = {
    sources,
    context: {
      cluster: scope.cluster,
      identityDomain,
      namespaces: sources.find(source => source.key === 'namespaces') ?? empty,
      destinationRules: sources.find(source => source.key === 'destinationRules') ?? empty,
      serviceEntries: sources.find(source => source.key === 'serviceEntries') ?? empty,
      virtualServices: sources.find(source => source.key === 'virtualServices') ?? empty,
      sidecars: sources.find(source => source.key === 'sidecars') ?? empty,
      gateways: sources.find(source => source.key === 'gateways') ?? empty,
      istioGateways: sources.find(source => source.key === 'istioGateways') ?? empty,
      services: sources.find(source => source.key === 'services') ?? empty,
      referenceGrants: sources.find(source => source.key === 'referenceGrants') ?? empty,
      peerAuthentications: sources.find(source => source.key === 'peerAuthentications') ?? empty,
      workloadGroups: {
        ...(sources.find(source => source.key === 'workloadGroups') ?? empty),
        namespace: sources.find(source => source.key === 'workloadGroups')?.namespace ?? '',
      },
    },
  };
  if (classesRequested) {
    try {
      snapshot.context.gatewayClassRegistry = resolveGatewayClassRegistry(
        classSettings,
        sources.find(source => source.key === 'gatewayClasses')
      );
    } catch (error) {
      if (signal.aborted) throw error;
      const source = sources.find(source => source.key === 'gatewayClasses');
      if (!source) throw error;
      if (source.complete) {
        source.complete = false;
        source.error = readFailure(error);
      }
    }
  }
  const needsImportContext =
    snapshot.context.sidecars.complete &&
    (snapshot.context.destinationRules.complete ||
      snapshot.context.serviceEntries?.complete ||
      snapshot.context.virtualServices?.complete) &&
    snapshot.context.namespaces.complete &&
    (snapshot.context.sidecars.items.length ||
      snapshot.context.destinationRules.items.length ||
      snapshot.context.serviceEntries?.items.length ||
      snapshot.context.virtualServices?.items.length);
  const needsRegistryContext =
    registryRequested &&
    snapshot.context.namespaces.complete &&
    snapshot.context.services?.complete &&
    snapshot.context.serviceEntries?.complete &&
    (kind !== 'AuthorizationPolicy' || snapshot.context.virtualServices?.complete);
  if (
    namespace &&
    (needsImportContext ||
      needsRegistryContext ||
      rootSelectorRequested ||
      peerRequested ||
      (peerSelectorsRequested &&
        snapshot.context.namespaces.complete &&
        snapshot.context.peerAuthentications?.complete) ||
      destinationPeerRequested)
  ) {
    const mesh = await loadMeshSnapshot(scope, signal);
    signal.throwIfAborted();
    const names = new Set([
      namespace,
      ...(needsImportContext
        ? [
            ...snapshot.context.destinationRules.items.map(item => item.namespace),
            ...(snapshot.context.serviceEntries?.items.map(item => item.namespace) ?? []),
            ...(snapshot.context.virtualServices?.items.map(item => item.namespace) ?? []),
          ]
        : []),
      ...(peerRequested ? snapshot.context.destinationRules.items.map(item => item.namespace) : []),
      ...(needsRegistryContext
        ? [
            ...(snapshot.context.services?.items.map(item => item.namespace) ?? []),
            ...(snapshot.context.serviceEntries?.items.map(item => item.namespace) ?? []),
            ...(snapshot.context.virtualServices?.items.map(item => item.namespace) ?? []),
          ]
        : []),
    ]);
    snapshot.context.namespaceMesh = new Map(
      [...names].map(name => [name, namespaceMeshConfiguration(mesh, name)])
    );
  }
  return snapshot;
}
