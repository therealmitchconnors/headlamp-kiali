import { isDnsSubdomain, isRecord } from '../core/object';
import { NamespaceScope, namespaceScope } from '../core/scope';
import {
  VirtualWorkloadGroup,
  VirtualWorkloadRecord,
  virtualWorkloadResources,
} from '../core/virtualWorkloads';
import {
  workloadEntryLabels,
  workloadGroupEntrySelector,
  workloadLabelBudget,
} from '../core/workloadGroupEntries';
import { configurationDefinitions } from '../resources/registry';
import { readCollection } from './collections';
import { discoverConfiguration } from './configuration';
import type { CorrelationSource, SourceSnapshot } from './correlation';
import { InvalidResponseError, observedResourceIdentity, readFailure } from './requests';

export const VIRTUAL_WORKLOAD_SOURCE: CorrelationSource = {
  kind: 'WorkloadGroup',
  group: 'networking.istio.io',
  apiVersion: 'networking.istio.io/v1',
  plural: 'workloadgroups',
};

function identity(
  value: Record<string, unknown>,
  scope: NamespaceScope,
  kind: 'WorkloadGroup' | 'WorkloadEntry',
  apiVersion: string
): Omit<VirtualWorkloadRecord, 'labels'> {
  const metadata = value.metadata;
  if (
    !isRecord(metadata) ||
    metadata.namespace !== scope.namespace ||
    !isDnsSubdomain(metadata.name)
  )
    throw new InvalidResponseError('Malformed or out-of-scope VM resource identity');
  return {
    name: metadata.name,
    namespace: scope.namespace,
    ...observedResourceIdentity(value, {
      kind,
      apiVersion,
      namespace: scope.namespace,
      name: metadata.name,
    }),
  };
}

export async function readVirtualWorkloadSource(
  requested: NamespaceScope,
  signal: AbortSignal
): Promise<SourceSnapshot> {
  const scope = namespaceScope(requested.cluster, requested.namespace);
  const countLabels = workloadLabelBudget();
  let source = { ...VIRTUAL_WORKLOAD_SOURCE };
  try {
    const groupDefinition = configurationDefinitions.find(
      item => item.kind === 'WorkloadGroup' && item.group === source.group
    );
    const entryDefinition = configurationDefinitions.find(
      item => item.kind === 'WorkloadEntry' && item.group === source.group
    );
    if (!groupDefinition || !entryDefinition)
      throw new Error('VM configuration definitions are unavailable');
    const available = await discoverConfiguration(scope, groupDefinition, signal);
    if (available.available === false) {
      if (available.reason === 'absent')
        return { source, resources: [], complete: true, notServed: true };
      throw new Error('WorkloadGroup API has no supported version for VM correlation');
    }
    source = { ...source, apiVersion: available.apiVersion };
    const groups = await readCollection(
      scope,
      {
        apiVersion: available.apiVersion,
        kind: 'WorkloadGroup',
        path: `/apis/${available.apiVersion}/namespaces/${encodeURIComponent(
          scope.namespace
        )}/workloadgroups`,
      },
      (value): VirtualWorkloadGroup => {
        const current = identity(value, scope, 'WorkloadGroup', available.apiVersion);
        if (!isRecord(value.metadata))
          throw new InvalidResponseError('Missing WorkloadGroup metadata');
        const labels = workloadEntryLabels(value.metadata.labels);
        const selector = workloadGroupEntrySelector(value.spec) ?? {};
        countLabels(labels);
        countLabels(selector);
        return {
          ...current,
          labels,
          selector,
        };
      },
      signal
    );
    if (!groups.complete)
      return {
        source,
        resources: [],
        complete: false,
        resourceVersion: groups.resourceVersion,
        limited: groups.limited,
        error: groups.error,
      };
    let entries: VirtualWorkloadRecord[] = [];
    if (groups.items.some(group => Object.keys(group.selector).length)) {
      const entryApi = await discoverConfiguration(scope, entryDefinition, signal);
      if (entryApi.available === false)
        throw new Error(`WorkloadEntry API is unavailable: ${entryApi.reason}`);
      const result = await readCollection(
        scope,
        {
          apiVersion: entryApi.apiVersion,
          kind: 'WorkloadEntry',
          path: `/apis/${entryApi.apiVersion}/namespaces/${encodeURIComponent(
            scope.namespace
          )}/workloadentries`,
        },
        (value): VirtualWorkloadRecord => {
          const current = identity(value, scope, 'WorkloadEntry', entryApi.apiVersion);
          if (!isRecord(value.spec))
            throw new InvalidResponseError('Missing WorkloadEntry specification');
          const labels = workloadEntryLabels(value.spec.labels);
          countLabels(labels);
          return { ...current, labels };
        },
        signal
      );
      if (!result.complete) {
        const detail = result.error?.message ?? 'four-page WorkloadEntry limit reached';
        return {
          source,
          resources: [],
          complete: false,
          limited: result.limited,
          error: {
            ...(result.error ?? { kind: 'invalid-response' }),
            message: `WorkloadEntry evidence is incomplete: ${detail}`,
          },
        };
      }
      entries = result.items;
    }
    return {
      source,
      resources: virtualWorkloadResources(scope, groups.items, entries),
      complete: true,
      resourceVersion: groups.resourceVersion,
    };
  } catch (error) {
    if (signal.aborted) throw error;
    return { source, resources: [], complete: false, error: readFailure(error) };
  }
}
