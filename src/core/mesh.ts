import { JSON_SCHEMA, load, YAMLException } from 'js-yaml';
import { WorkloadStatus } from './health';
import { decodeLabelSelector, isLabelValue, matchesSelector } from './labels';
import { namespaceRevisionSelection } from './namespaceRevision';
import { isDnsLabel, isDnsSubdomain, isRecord } from './object';
import { workloadHealthResource } from './workloadHealth';

export interface NamespaceObservation {
  name: string;
  labels: Readonly<Record<string, string>>;
}
export interface ControlPlaneObservation {
  name: string;
  namespace: string;
  uid: string;
  revision: string;
  configurationContainer?: string;
  image?: string;
  clusterId?: string;
  sharedMeshConfig?: string;
  managesExternal: boolean | null;
  effectiveConfigBlocked: boolean;
  replicas: WorkloadStatus | null;
  stale: boolean;
  configurationWarnings: string[];
}
export interface RevisionTag {
  name: string;
  tag: string;
  revision: string;
}
export interface MeshConfigFields {
  rootNamespace?: string;
  trustDomain?: string;
  trustDomainAliases?: string[];
  enableAutoMtls?: boolean;
  hasDiscoverySelectors: boolean;
  discoverySelectors?: Record<string, unknown>[];
  defaultDestinationRuleExportTo?: string[];
  defaultVirtualServiceExportTo?: string[];
  defaultServiceExportTo?: string[];
  outboundTrafficPolicy?: {
    mode: 'ALLOW_ANY' | 'REGISTRY_ONLY' | 'ALLOW_ANY_DYNAMIC_DNS';
    basis: 'explicit' | 'protobuf-default';
  };
}
export type NamespaceMeshConfiguration =
  | {
      status: 'ready';
      controller: string;
      fields: MeshConfigFields;
      discovery?: NamespaceDiscoveryBasis;
      root?: { namespace: string; basis: 'configured' | 'controller-namespace' };
    }
  | { status: 'unavailable'; message: string };
export type NamespaceDiscoveryBasis = 'unrestricted' | 'selector' | 'implicit';

export function resolvedMeshRoot(fields: MeshConfigFields, controllerNamespace: string) {
  const namespace = fields.rootNamespace || controllerNamespace;
  if (!isDnsLabel(namespace) || !isDnsLabel(controllerNamespace))
    throw new Error(
      'Mesh root resolution requires valid configured/controller namespace identities'
    );
  return {
    namespace,
    basis: fields.rootNamespace ? ('configured' as const) : ('controller-namespace' as const),
  };
}

export function validationMeshRoot(configuration: NamespaceMeshConfiguration | undefined) {
  if (configuration?.status !== 'ready')
    throw new Error(
      configuration?.status === 'unavailable'
        ? configuration.message
        : 'A resolved namespace mesh configuration is required'
    );
  const root = configuration.root?.namespace ?? configuration.fields.rootNamespace;
  if (!isDnsLabel(root)) throw new Error('A resolved mesh root namespace is required');
  return root;
}
export type NamespaceDiscoveryAssessment =
  | { status: 'included'; basis: NamespaceDiscoveryBasis }
  | { status: 'excluded' | 'unavailable'; message: string };

export function namespaceDiscovery(
  namespace: NamespaceObservation,
  controllerNamespace: string,
  fields: MeshConfigFields
): NamespaceDiscoveryAssessment {
  try {
    if (
      !isDnsLabel(namespace.name) ||
      namespace.name.trim() !== namespace.name ||
      !isDnsLabel(controllerNamespace) ||
      controllerNamespace.trim() !== controllerNamespace
    )
      throw new Error('Namespace discovery requires explicit valid namespace identities');
    const raw = fields.discoverySelectors ?? [];
    if (!Array.isArray(raw) || raw.length > 100 || fields.hasDiscoverySelectors !== raw.length > 0)
      throw new Error('Discovery selector metadata is inconsistent or exceeds 100 selectors');
    let budget = 0;
    const selectors = raw.map(value => {
      const selector = decodeLabelSelector(value);
      budget +=
        1 +
        Object.keys(selector.matchLabels ?? {}).length +
        (selector.matchExpressions ?? []).reduce(
          (count, expression) => count + 1 + (expression.values?.length ?? 0),
          0
        );
      if (budget > 1000)
        throw new Error('Discovery selectors exceed 1000 combined requirements and values');
      return selector;
    });
    if (namespace.name === controllerNamespace || namespace.name === fields.rootNamespace)
      return { status: 'included', basis: 'implicit' };
    if (!selectors.length) return { status: 'included', basis: 'unrestricted' };
    if (selectors.some(selector => matchesSelector(namespace.labels, selector)))
      return { status: 'included', basis: 'selector' };
    return {
      status: 'excluded',
      message: 'Namespace is excluded by the configured Istio discovery selectors',
    };
  } catch (error) {
    return {
      status: 'unavailable',
      message:
        error instanceof Error
          ? error.message
          : 'Unable to evaluate configured discovery selectors',
    };
  }
}
export interface InjectorFields {
  network?: string;
  meshId?: string;
  clusterDomain?: string;
  serviceIdentityDomain?: string;
}

function labels(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value) || Object.values(value).some(value => typeof value !== 'string'))
    throw new Error('Malformed resource labels');
  return Object.fromEntries(Object.entries(value).map(([key, value]) => [key, String(value)]));
}

export function namespaceObservation(value: Record<string, unknown>): NamespaceObservation {
  if (
    !isRecord(value.metadata) ||
    !isDnsLabel(value.metadata.name) ||
    (value.metadata.namespace !== undefined && value.metadata.namespace !== '')
  )
    throw new Error('Malformed Namespace identity');
  return { name: value.metadata.name, labels: labels(value.metadata.labels) };
}

export function revisionTag(value: Record<string, unknown>): RevisionTag {
  if (!isRecord(value.metadata) || !isDnsSubdomain(value.metadata.name))
    throw new Error('Malformed revision-tag identity');
  const found = labels(value.metadata.labels);
  if (!Object.prototype.hasOwnProperty.call(found, 'istio.io/tag'))
    throw new Error('Revision tag is missing its tag label');
  const tag = found['istio.io/tag'];
  const revision = found['istio.io/rev'] ?? '';
  if (!isLabelValue(tag) || !isLabelValue(revision))
    throw new Error('Revision tag values must be bounded Kubernetes labels');
  return { name: value.metadata.name, tag, revision };
}

export function selectedRevisionTags(tags: readonly RevisionTag[]) {
  const selected = new Map<string, RevisionTag>();
  const ignored: RevisionTag[] = [];
  for (const tag of tags) {
    if (selected.has(tag.revision)) ignored.push(tag);
    else selected.set(tag.revision, tag);
  }
  return { selected, ignored };
}

export function revisionConfigMapName(
  base: 'istio' | 'istio-sidecar-injector',
  revision: string
): string {
  const name = !revision || revision === 'default' ? base : `${base}-${revision}`;
  if (!isDnsSubdomain(name))
    throw new Error('Revision cannot be used in a standard ConfigMap name');
  return name;
}

export function controlPlaneObservation(value: Record<string, unknown>): ControlPlaneObservation {
  if (
    !isRecord(value.metadata) ||
    !isDnsSubdomain(value.metadata.name) ||
    !isDnsLabel(value.metadata.namespace) ||
    typeof value.metadata.uid !== 'string' ||
    !value.metadata.uid ||
    !isRecord(value.spec) ||
    !isRecord(value.spec.template) ||
    !isRecord(value.spec.template.spec)
  )
    throw new Error('Malformed istiod Deployment');
  const found = labels(value.metadata.labels);
  if (found.app !== 'istiod')
    throw new Error('Deployment did not match the istiod discovery selector');
  const revision = found['istio.io/rev'] ?? '';
  const pod = value.spec.template.spec;
  if (pod.containers !== undefined && !Array.isArray(pod.containers))
    throw new Error('Malformed istiod container list');
  const first: unknown = Array.isArray(pod.containers) ? pod.containers[0] : undefined;
  if (first !== undefined && !isRecord(first)) throw new Error('Malformed first istiod container');
  const container = isRecord(first) ? first : undefined;
  const configurationWarnings: string[] = [];
  let effectiveConfigBlocked = !container;
  const rawEnv = container?.env;
  if (rawEnv !== undefined && rawEnv !== null && !Array.isArray(rawEnv))
    throw new Error('Malformed istiod environment list');
  const env = (Array.isArray(rawEnv) ? rawEnv : []).map(entry => {
    if (
      !isRecord(entry) ||
      typeof entry.name !== 'string' ||
      !entry.name ||
      (entry.value !== undefined && typeof entry.value !== 'string') ||
      (entry.valueFrom !== undefined && entry.valueFrom !== null && !isRecord(entry.valueFrom))
    )
      throw new Error('Malformed istiod environment variable');
    return { name: entry.name, value: entry.value, valueFrom: entry.valueFrom };
  });
  const assignments = new Map(env.map(entry => [entry.name, entry]));
  const literal = (name: string) => {
    const entry = assignments.get(name);
    if (!entry) return undefined;
    if (entry.valueFrom !== undefined && entry.valueFrom !== null) {
      configurationWarnings.push(`${name} uses indirection and was not resolved`);
      if (name !== 'CLUSTER_ID') effectiveConfigBlocked = true;
      return undefined;
    }
    return typeof entry.value === 'string' ? entry.value : '';
  };
  const clusterId = literal('CLUSTER_ID');
  const shared = literal('SHARED_MESH_CONFIG');
  const external = env.filter(entry => entry.name === 'EXTERNAL_ISTIOD');
  const indirectExternal = external.some(
    entry => entry.valueFrom !== undefined && entry.valueFrom !== null
  );
  const noncanonicalExternal = external.some(
    entry => !['', 'true', 'false'].includes(typeof entry.value === 'string' ? entry.value : '')
  );
  if (indirectExternal)
    configurationWarnings.push('EXTERNAL_ISTIOD uses indirection and was not resolved');
  if (noncanonicalExternal)
    configurationWarnings.push(
      'Noncanonical EXTERNAL_ISTIOD values are not interpreted as resolved topology'
    );
  const managesExternal =
    indirectExternal || noncanonicalExternal
      ? null
      : external.some(entry => entry.value === 'true');
  if (managesExternal !== false) {
    configurationWarnings.push('External control-plane topology is not resolved');
    effectiveConfigBlocked = true;
  }
  if (!container) configurationWarnings.push('The first declared container was not found');
  const args = container && Array.isArray(container.args) ? container.args : [];
  if (
    args.some(
      arg =>
        typeof arg === 'string' &&
        (arg === '--meshConfigFile' || arg.startsWith('--meshConfigFile='))
    )
  ) {
    configurationWarnings.push('Explicit mesh configuration file overrides are not evaluated');
    effectiveConfigBlocked = true;
  }
  if (container && Array.isArray(container.volumeMounts)) {
    const standard = revisionConfigMapName('istio', revision);
    for (const mount of container.volumeMounts) {
      if (!isRecord(mount) || typeof mount.mountPath !== 'string') continue;
      const path = mount.mountPath.replace(/\/+$/, '') || '/';
      if (
        !(
          path === '/' ||
          path === '/etc/istio/config/mesh' ||
          '/etc/istio/config/mesh'.startsWith(`${path}/`)
        )
      )
        continue;
      const volume = Array.isArray(pod.volumes)
        ? pod.volumes.find(volume => isRecord(volume) && volume.name === mount.name)
        : undefined;
      if (
        path !== '/etc/istio/config' ||
        !isRecord(volume) ||
        !isRecord(volume.configMap) ||
        volume.configMap.name !== standard ||
        volume.configMap.items !== undefined ||
        mount.subPath !== undefined ||
        mount.subPathExpr !== undefined
      ) {
        configurationWarnings.push('Mounted mesh configuration overrides are not evaluated');
        effectiveConfigBlocked = true;
      }
    }
  }
  const health = workloadHealthResource(value, {
    kind: 'Deployment',
    namespace: value.metadata.namespace,
    name: value.metadata.name,
  });
  return {
    name: value.metadata.name,
    namespace: value.metadata.namespace,
    uid: value.metadata.uid,
    revision,
    configurationContainer: typeof container?.name === 'string' ? container.name : undefined,
    image: typeof container?.image === 'string' ? container.image : undefined,
    clusterId,
    sharedMeshConfig: shared || undefined,
    managesExternal,
    effectiveConfigBlocked,
    replicas: health.replicas,
    stale: health.stale,
    configurationWarnings: [...new Set(configurationWarnings)],
  };
}

function document(value: unknown, format: 'yaml' | 'json'): Record<string, unknown> {
  if (
    typeof value !== 'string' ||
    value.length > 262144 ||
    new TextEncoder().encode(value).length > 262144
  )
    throw new Error('Configuration text is missing or exceeds 256 KiB');
  let parsed: unknown;
  try {
    parsed = format === 'yaml' ? load(value, { schema: JSON_SCHEMA }) : JSON.parse(value);
  } catch (error) {
    // Parser messages can embed arbitrary ConfigMap contents; never echo source excerpts.
    if (error instanceof YAMLException)
      throw new Error(`Invalid mesh YAML${error.mark ? ` at line ${error.mark.line + 1}` : ''}`);
    if (error instanceof SyntaxError) throw new Error('Invalid configuration JSON');
    throw error;
  }
  if (format === 'yaml' && (parsed === undefined || parsed === null)) return {};
  if (!isRecord(parsed)) throw new Error('Configuration must be a mapping');
  return parsed;
}

function text(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > 1024)
    throw new Error(`Invalid ${field} configuration field`);
  return value;
}

export function meshConfigFields(yaml: unknown): MeshConfigFields {
  const value = document(yaml, 'yaml');
  const rootNamespace = text(value.rootNamespace, 'rootNamespace');
  if (rootNamespace !== undefined && rootNamespace !== '' && !isDnsLabel(rootNamespace))
    throw new Error('Invalid configured root namespace');
  const trustDomain = text(value.trustDomain, 'trustDomain');
  const aliases = value.trustDomainAliases ?? undefined;
  if (
    aliases !== undefined &&
    (!Array.isArray(aliases) ||
      aliases.length > 100 ||
      aliases.some(alias => typeof alias !== 'string' || alias.length > 1024))
  )
    throw new Error('Invalid trust domain aliases');
  if (
    value.enableAutoMtls !== undefined &&
    value.enableAutoMtls !== null &&
    typeof value.enableAutoMtls !== 'boolean'
  )
    throw new Error('Invalid automatic mTLS configuration');
  const selectors = value.discoverySelectors ?? undefined;
  if (
    selectors !== undefined &&
    (!Array.isArray(selectors) ||
      selectors.length > 100 ||
      selectors.some(value => !isRecord(value)))
  )
    throw new Error('Invalid discovery selectors');
  const exports = (field: string): string[] | undefined => {
    const entries = value[field];
    if (entries === undefined || entries === null) return undefined;
    if (
      !Array.isArray(entries) ||
      entries.length > 100 ||
      entries.some(entry => typeof entry !== 'string' || entry.length > 1024)
    )
      throw new Error(`Invalid ${field} configuration`);
    return entries.map(entry => String(entry));
  };
  let outboundTrafficPolicy: MeshConfigFields['outboundTrafficPolicy'];
  if (value.outboundTrafficPolicy !== undefined && value.outboundTrafficPolicy !== null) {
    if (!isRecord(value.outboundTrafficPolicy)) throw new Error('Invalid outbound traffic policy');
    const mode = value.outboundTrafficPolicy.mode;
    if (mode === undefined || mode === null)
      outboundTrafficPolicy = { mode: 'REGISTRY_ONLY', basis: 'protobuf-default' };
    else if (mode === 'REGISTRY_ONLY' || mode === 0)
      outboundTrafficPolicy = { mode: 'REGISTRY_ONLY', basis: 'explicit' };
    else if (mode === 'ALLOW_ANY' || mode === 1)
      outboundTrafficPolicy = { mode: 'ALLOW_ANY', basis: 'explicit' };
    else if (mode === 'ALLOW_ANY_DYNAMIC_DNS' || mode === 3)
      outboundTrafficPolicy = { mode: 'ALLOW_ANY_DYNAMIC_DNS', basis: 'explicit' };
    else throw new Error('Invalid outbound traffic policy mode');
  }
  return {
    rootNamespace,
    trustDomain,
    trustDomainAliases: Array.isArray(aliases) ? aliases.map(alias => String(alias)) : undefined,
    enableAutoMtls: typeof value.enableAutoMtls === 'boolean' ? value.enableAutoMtls : undefined,
    hasDiscoverySelectors: Array.isArray(selectors) && selectors.length > 0,
    discoverySelectors: Array.isArray(selectors) ? selectors.filter(isRecord) : undefined,
    defaultDestinationRuleExportTo: exports('defaultDestinationRuleExportTo'),
    defaultVirtualServiceExportTo: exports('defaultVirtualServiceExportTo'),
    defaultServiceExportTo: exports('defaultServiceExportTo'),
    outboundTrafficPolicy,
  };
}

/** Project the pinned shared/local merge for selected fields, without runtime defaults. */
export function mergeMeshFields(
  local: MeshConfigFields,
  shared: MeshConfigFields
): MeshConfigFields {
  const selectors = local.discoverySelectors?.length
    ? local.discoverySelectors
    : shared.discoverySelectors;
  return {
    rootNamespace: local.rootNamespace || shared.rootNamespace || undefined,
    trustDomain: local.trustDomain || shared.trustDomain || undefined,
    enableAutoMtls: local.enableAutoMtls ?? shared.enableAutoMtls,
    outboundTrafficPolicy: local.outboundTrafficPolicy ?? shared.outboundTrafficPolicy,
    trustDomainAliases:
      local.trustDomainAliases === undefined && shared.trustDomainAliases === undefined
        ? undefined
        : [
            ...new Set([...(shared.trustDomainAliases ?? []), ...(local.trustDomainAliases ?? [])]),
          ].sort(),
    discoverySelectors: selectors,
    hasDiscoverySelectors: !!selectors?.length,
    defaultDestinationRuleExportTo: local.defaultDestinationRuleExportTo?.length
      ? local.defaultDestinationRuleExportTo
      : shared.defaultDestinationRuleExportTo,
    defaultVirtualServiceExportTo: local.defaultVirtualServiceExportTo?.length
      ? local.defaultVirtualServiceExportTo
      : shared.defaultVirtualServiceExportTo,
    defaultServiceExportTo: local.defaultServiceExportTo?.length
      ? local.defaultServiceExportTo
      : shared.defaultServiceExportTo,
  };
}

export function validationOutboundPolicy(configuration: NamespaceMeshConfiguration | undefined) {
  if (configuration?.status !== 'ready')
    throw new Error(
      configuration?.status === 'unavailable'
        ? configuration.message
        : 'Outbound policy requires resolved namespace mesh configuration'
    );
  return (
    configuration.fields.outboundTrafficPolicy ?? {
      mode: 'ALLOW_ANY' as const,
      basis: 'kiali-default' as const,
    }
  );
}

export function injectorFields(json: unknown): InjectorFields {
  const value = document(json, 'json');
  if (!isRecord(value.global)) throw new Error('Injector values.global is missing or malformed');
  if (value.global.proxy !== undefined && !isRecord(value.global.proxy))
    throw new Error('Invalid injector proxy configuration');
  const domain = isRecord(value.global.proxy)
    ? text(value.global.proxy.clusterDomain, 'clusterDomain')
    : undefined;
  if (domain !== undefined && !isDnsSubdomain(domain))
    throw new Error('Invalid configured cluster DNS suffix');
  return {
    clusterDomain: domain,
    serviceIdentityDomain: domain ? `svc.${domain}` : undefined,
    meshId: text(value.global.meshID, 'meshID'),
    network: text(value.global.network, 'network'),
  };
}

export interface NamespaceAssociation {
  namespace: NamespaceObservation;
  mode: 'ambient' | 'disabled' | 'revision' | 'default' | 'unselected' | 'conflicting' | 'unknown';
  requestedRevision?: string;
  controllers: ControlPlaneObservation[];
  complete: boolean;
}

export function namespaceAssociations(
  namespaces: readonly NamespaceObservation[],
  controllers: readonly ControlPlaneObservation[],
  tags: readonly RevisionTag[],
  discoveryComplete: boolean
): NamespaceAssociation[] {
  const tagsByRevision = selectedRevisionTags(tags).selected;
  return namespaces.map(namespace => {
    const injection = namespace.labels['istio-injection'];
    const revision = namespace.labels['istio.io/rev'];
    const ambient = namespace.labels['istio.io/dataplane-mode'] === 'ambient';
    const mode: NamespaceAssociation['mode'] =
      injection !== undefined && revision !== undefined
        ? 'conflicting'
        : ambient
        ? 'ambient'
        : injection === 'disabled'
        ? 'disabled'
        : revision !== undefined
        ? 'revision'
        : injection === 'enabled'
        ? 'default'
        : injection !== undefined
        ? 'unknown'
        : 'unselected';
    const selection = namespaceRevisionSelection(namespace.labels);
    const requestedRevision =
      selection.ok &&
      selection.basis !== 'maistra-member' &&
      ['revision', 'ambient', 'default'].includes(mode)
        ? selection.revision
        : undefined;
    return {
      namespace,
      mode,
      requestedRevision,
      controllers: controllers.filter(
        controller =>
          !!requestedRevision &&
          requestedRevision ===
            (tagsByRevision.get(controller.revision)?.tag ?? controller.revision)
      ),
      complete: discoveryComplete,
    };
  });
}
