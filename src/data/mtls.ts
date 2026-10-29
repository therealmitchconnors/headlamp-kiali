import { namespaceDiscovery, resolvedMeshRoot } from '../core/mesh';
import {
  assessNamespaceTls,
  clientTlsMode,
  NamespaceTlsAssessment,
  peerMtlsMode,
  TlsDestinationRule,
  TlsPeerPolicy,
} from '../core/mtls';
import { isDnsLabel, isDnsSubdomain, isRecord } from '../core/object';
import { ClusterScope } from '../core/scope';
import { configurationDefinitions } from '../resources/registry';
import { CollectionRead, readCollection } from './collections';
import { discoverConfiguration } from './configuration';
import { loadMeshSnapshot, MeshControlPlane } from './mesh';
import { InvalidResponseError, readFailure } from './requests';

export interface MtlsQuery {
  namespace: string;
  controllerNamespace: string;
  controller: string;
}
export interface MtlsSnapshot {
  query: MtlsQuery;
  controller: MeshControlPlane;
  rootNamespace: string;
  rootNamespaceDefaulted?: boolean;
  identityDomain: string;
  autoMtlsEnabled: boolean;
  autoMtlsDefaulted: boolean;
  peers: CollectionRead<TlsPeerPolicy>;
  destinationRules: CollectionRead<TlsDestinationRule>;
  assessment?: NamespaceTlsAssessment;
  reason?: string;
}

function policyIdentity(value: Record<string, unknown>, expectedNamespace?: string) {
  if (
    !isRecord(value.metadata) ||
    !isDnsSubdomain(value.metadata.name) ||
    !isDnsLabel(value.metadata.namespace) ||
    (expectedNamespace !== undefined && value.metadata.namespace !== expectedNamespace) ||
    !isRecord(value.spec ?? {})
  )
    throw new InvalidResponseError('Invalid policy identity or specification');
  return {
    name: value.metadata.name,
    namespace: value.metadata.namespace,
    spec: isRecord(value.spec) ? value.spec : {},
  };
}

function peer(value: Record<string, unknown>, expectedNamespace: string): TlsPeerPolicy {
  const { name, namespace, spec } = policyIdentity(value, expectedNamespace);
  const mode = decodeMode(() => peerMtlsMode(spec.mtls));
  let selector: Record<string, string> | undefined;
  if (spec.selector !== undefined && spec.selector !== null) {
    if (!isRecord(spec.selector))
      throw new InvalidResponseError('Invalid PeerAuthentication selector');
    if (Object.keys(spec.selector).some(key => key !== 'matchLabels'))
      throw new InvalidResponseError('Unsupported PeerAuthentication selector fields');
    const labels = spec.selector.matchLabels ?? {};
    if (!isRecord(labels) || Object.values(labels).some(value => typeof value !== 'string'))
      throw new InvalidResponseError('Invalid PeerAuthentication selector labels');
    selector = Object.fromEntries(
      Object.entries(labels).map(([key, value]) => [key, String(value)])
    );
  }
  return { name, namespace, mode, selector };
}

function destination(value: Record<string, unknown>): TlsDestinationRule {
  const { name, namespace, spec } = policyIdentity(value);
  if (typeof spec.host !== 'string') throw new InvalidResponseError('Invalid DestinationRule host');
  if (
    spec.trafficPolicy !== undefined &&
    spec.trafficPolicy !== null &&
    !isRecord(spec.trafficPolicy)
  )
    throw new InvalidResponseError('Invalid DestinationRule traffic policy');
  const tls = isRecord(spec.trafficPolicy) ? spec.trafficPolicy.tls : undefined;
  const mode = decodeMode(() => clientTlsMode(tls));
  return { name, namespace, host: spec.host, mode };
}

function decodeMode<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw new InvalidResponseError(error instanceof Error ? error.message : 'Invalid TLS mode');
  }
}

async function policies<T>(
  scope: ClusterScope,
  kind: 'PeerAuthentication' | 'DestinationRule',
  namespace: string | undefined,
  decode: (value: Record<string, unknown>) => T,
  signal: AbortSignal
): Promise<CollectionRead<T>> {
  try {
    const definition = configurationDefinitions.find(definition => definition.kind === kind);
    if (!definition) throw new Error('Missing configuration model for mTLS assessment');
    const availability = await discoverConfiguration(scope, definition, signal);
    if (availability.available === false)
      throw new Error(`${kind} API unavailable: ${availability.reason}`);
    const path = `/apis/${availability.apiVersion}${
      namespace ? `/namespaces/${encodeURIComponent(namespace)}` : ''
    }/${definition.plural}`;
    return await readCollection(
      scope,
      { path, kind, apiVersion: availability.apiVersion },
      decode,
      signal
    );
  } catch (error) {
    if (signal.aborted) throw error;
    return { items: [], complete: false, error: readFailure(error) };
  }
}

export async function loadMtlsSnapshot(
  scope: ClusterScope,
  query: MtlsQuery,
  configuredDomain: string | null,
  signal: AbortSignal
): Promise<MtlsSnapshot> {
  signal.throwIfAborted();
  if (
    !isDnsLabel(query.namespace) ||
    !isDnsLabel(query.controllerNamespace) ||
    !isDnsSubdomain(query.controller)
  )
    throw new Error('A namespace and an explicit controller identity are required');
  const mesh = await loadMeshSnapshot(scope, signal);
  if (!mesh.controllers.complete || !mesh.namespaces.complete)
    throw new Error(
      'Controller or namespace discovery is incomplete; mTLS configuration is unavailable'
    );
  const namespace = mesh.namespaces.items.find(namespace => namespace.name === query.namespace);
  if (!namespace) throw new Error('The selected namespace was not found or accessible');
  if (namespace.labels['istio.io/dataplane-mode'] === 'ambient')
    throw new Error('Ambient mTLS assessment is not implemented by this configuration indicator');
  const controller = mesh.controlPlanes.find(
    plane =>
      plane.controller.name === query.controller &&
      plane.controller.namespace === query.controllerNamespace
  );
  if (!controller || controller.effective?.status !== 'ready')
    throw new Error('The selected controller configuration is unresolved');
  const root = resolvedMeshRoot(controller.effective.value, controller.controller.namespace);
  const rootNamespace = root.namespace;
  const discovery = namespaceDiscovery(
    namespace,
    controller.controller.namespace,
    controller.effective.value
  );
  if (discovery.status !== 'included') throw new Error(discovery.message);
  const identityDomain =
    configuredDomain ??
    (controller.injector.status === 'ready'
      ? controller.injector.value.serviceIdentityDomain
      : undefined);
  if (!isDnsSubdomain(identityDomain))
    throw new Error(
      'Set an explicit service DNS identity domain or resolve the injector configuration'
    );
  const autoMtlsDefaulted = controller.effective.value.enableAutoMtls === undefined;
  const autoMtlsEnabled = controller.effective.value.enableAutoMtls ?? true;
  const [namespacePeers, meshPeers, destinationRules] = await Promise.all([
    policies(
      scope,
      'PeerAuthentication',
      query.namespace,
      value => peer(value, query.namespace),
      signal
    ),
    rootNamespace === query.namespace
      ? Promise.resolve<CollectionRead<TlsPeerPolicy>>({ items: [], complete: true })
      : policies(
          scope,
          'PeerAuthentication',
          rootNamespace,
          value => peer(value, rootNamespace),
          signal
        ),
    policies(scope, 'DestinationRule', undefined, destination, signal),
  ]);
  const peers: CollectionRead<TlsPeerPolicy> = {
    items: [...namespacePeers.items, ...meshPeers.items],
    complete: namespacePeers.complete && meshPeers.complete,
    error: namespacePeers.error ?? meshPeers.error,
    limited: namespacePeers.limited || meshPeers.limited,
  };
  const result: MtlsSnapshot = {
    query,
    controller,
    rootNamespace,
    rootNamespaceDefaulted: root.basis === 'controller-namespace',
    identityDomain,
    autoMtlsEnabled,
    autoMtlsDefaulted,
    peers,
    destinationRules,
  };
  if (!peers.complete || !destinationRules.complete)
    result.reason = 'Policy visibility is incomplete; no mTLS configuration indicator was inferred';
  else {
    try {
      result.assessment = assessNamespaceTls(query.namespace, rootNamespace, identityDomain, {
        autoMtlsEnabled,
        allowPermissive: false,
        peerAuthentications: peers.items,
        destinationRules: destinationRules.items,
      });
    } catch (error) {
      result.reason =
        error instanceof Error ? error.message : 'Unable to assess mTLS configuration';
    }
  }
  return result;
}
