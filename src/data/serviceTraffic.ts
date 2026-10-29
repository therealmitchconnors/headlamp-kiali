import { correlateResources } from '../core/correlation';
import { getHost, hostString, hostWithinWildcardHost } from '../core/hosts';
import { AppLabels } from '../core/labels';
import { isDnsLabel, isDnsSubdomain, isRecord } from '../core/object';
import { NamespaceScope, namespaceScope } from '../core/scope';
import {
  RoutingService,
  routingService,
  ServiceTrafficDraft,
  serviceTrafficPlan,
  serviceTrafficVersions,
  ServiceVersion,
} from '../core/serviceTraffic';
import { ConfigurationDefinition, configurationDefinitions } from '../resources/registry';
import { readCollection } from './collections';
import { discoverConfiguration } from './configuration';
import { loadCorrelationSnapshot } from './correlation';
import { MutationConflict, PreparedMutation, prepareMutation } from './mutations';
import { readCluster, readFailure } from './requests';

export interface ServiceTrafficQuery {
  namespace: string;
  service: string;
  identityDomain: string;
  versionLabel?: string;
}
export interface ServiceTrafficSource {
  service: RoutingService;
  identityDomain: string;
  versionLabel: string;
  versions: ServiceVersion[];
  conflicts: { kind: string; namespace: string; name: string }[];
  definitions: { definition: ConfigurationDefinition; apiVersion: string }[];
}
export async function loadServiceTrafficSource(
  cluster: string,
  query: ServiceTrafficQuery,
  appLabels: AppLabels | null,
  signal: AbortSignal
): Promise<ServiceTrafficSource> {
  const scope = namespaceScope(cluster, query.namespace);
  if (!isDnsLabel(query.service) || !isDnsSubdomain(query.identityDomain))
    throw new Error('A Service name and explicit Service DNS suffix are required');
  const snapshot = await loadCorrelationSnapshot(scope, signal);
  if (!snapshot.complete)
    throw new Error('Service routing requires complete namespace resource lists');
  const correlation = correlateResources(snapshot.resources, appLabels);
  if (correlation.issues.length)
    throw new Error('Service routing cannot use unresolved workload ownership');
  const relation = correlation.serviceRelations.find(
    item => item.service.identity.name === query.service
  );
  if (!relation) throw new Error('The selected Service was not returned by namespace discovery');
  const service = routingService(
    await readCluster(
      scope,
      `/api/v1/namespaces/${scope.namespace}/services/${query.service}`,
      signal
    ),
    cluster,
    scope.namespace,
    query.service
  );
  if (
    service.uid !== relation.service.identity.uid ||
    service.resourceVersion !== relation.service.resourceVersion
  )
    throw new MutationConflict('The Service changed during discovery; load its versions again');
  const versions = serviceTrafficVersions(relation, query.versionLabel);
  const definitions = await Promise.all(
    ['DestinationRule', 'VirtualService'].map(async kind => {
      const definition = configurationDefinitions.find(
        item => item.group === 'networking.istio.io' && item.kind === kind
      );
      if (!definition) throw new Error('Missing traffic configuration model');
      const availability = await discoverConfiguration(scope, definition, signal);
      if (availability.available === false) throw new Error(`${kind} API is unavailable`);
      return { definition, apiVersion: availability.apiVersion };
    })
  );
  const fqdn = `${service.name}.${service.namespace}.${query.identityDomain}`;
  const matches = (raw: string, namespace: string) => {
    const candidate = hostString(
      getHost(raw, namespace, [service.namespace], query.identityDomain)
    );
    return raw === '*' || candidate === fqdn || hostWithinWildcardHost(fqdn, candidate);
  };
  const collections = await Promise.all(
    definitions.map(async ({ definition, apiVersion }) => {
      const result = await readCollection(
        scope,
        { path: `/apis/${apiVersion}/${definition.plural}`, apiVersion, kind: definition.kind },
        item => {
          if (
            !isRecord(item.metadata) ||
            !isDnsSubdomain(item.metadata.name) ||
            !isDnsLabel(item.metadata.namespace) ||
            !isRecord(item.spec)
          )
            throw new Error('Invalid routing configuration identity');
          const hosts = definition.kind === 'DestinationRule' ? [item.spec.host] : item.spec.hosts;
          if (!Array.isArray(hosts) || hosts.some(host => typeof host !== 'string'))
            throw new Error('Invalid routing host list');
          const namespace = item.metadata.namespace;
          return {
            kind: definition.kind,
            name: item.metadata.name,
            namespace,
            matches: hosts.some(host => matches(String(host), namespace)),
          };
        },
        signal
      );
      if (!result.complete)
        throw new Error(
          `${definition.kind} visibility is incomplete; configuration overlap cannot be ruled out`
        );
      return result.items.filter(item => item.matches);
    })
  );
  return {
    service,
    identityDomain: query.identityDomain,
    versionLabel: versions.label,
    versions: versions.versions,
    conflicts: collections.flat(),
    definitions,
  };
}

export function prepareServiceTraffic(
  source: ServiceTrafficSource,
  draft: ServiceTrafficDraft
): PreparedMutation[] {
  if (source.conflicts.length)
    throw new Error(
      'Potentially overlapping routing configuration exists; use its existing configuration editor'
    );
  const plan = serviceTrafficPlan(
    source.service,
    source.identityDomain,
    source.versionLabel,
    source.versions,
    draft
  );
  return source.definitions.map(({ definition, apiVersion }) =>
    prepareMutation(
      {
        cluster: source.service.cluster,
        namespace: source.service.namespace,
        name:
          definition.kind === 'DestinationRule'
            ? draft.destinationRuleName
            : draft.virtualServiceName,
        apiVersion,
        definition,
      },
      'create',
      JSON.stringify(
        definition.kind === 'DestinationRule' ? plan.destinationRule : plan.virtualService
      )
    )
  );
}

export async function assertTrafficSourceCurrent(service: RoutingService, signal: AbortSignal) {
  const scope = namespaceScope(service.cluster, service.namespace);
  if (!isDnsLabel(service.name)) throw new Error('Invalid routing Service identity');
  const current = routingService(
    await readCluster(
      scope,
      `/api/v1/namespaces/${scope.namespace}/services/${service.name}`,
      signal
    ),
    service.cluster,
    service.namespace,
    service.name
  );
  if (current.uid !== service.uid || current.resourceVersion !== service.resourceVersion)
    throw new MutationConflict(
      'The Service changed after the proposal was prepared; load a new proposal'
    );
}

export async function assertTrafficProposalFresh(
  source: ServiceTrafficSource,
  signal: AbortSignal
) {
  const current = await loadServiceTrafficSource(
    source.service.cluster,
    {
      namespace: source.service.namespace,
      service: source.service.name,
      identityDomain: source.identityDomain,
      versionLabel: source.versionLabel,
    },
    null,
    signal
  );
  if (
    current.service.uid !== source.service.uid ||
    current.service.resourceVersion !== source.service.resourceVersion ||
    JSON.stringify(current.versions) !== JSON.stringify(source.versions)
  )
    throw new MutationConflict(
      'Service or version membership changed; load a new routing proposal'
    );
  if (current.conflicts.length)
    throw new MutationConflict('Overlapping routing configuration appeared; load a new proposal');
}

export async function assertTrafficTargetsAbsent(
  mutations: readonly PreparedMutation[],
  signal: AbortSignal
) {
  for (const { target } of mutations) {
    const scope: NamespaceScope = namespaceScope(target.cluster, target.namespace);
    try {
      await readCluster(
        scope,
        `/apis/${target.apiVersion}/namespaces/${scope.namespace}/${
          target.definition.plural
        }/${encodeURIComponent(target.name)}`,
        signal
      );
    } catch (error) {
      if (signal.aborted) throw error;
      if (readFailure(error).kind === 'not-found') continue;
      throw error;
    }
    throw new MutationConflict(
      `${target.definition.kind} ${target.namespace}/${target.name} already exists`
    );
  }
}
