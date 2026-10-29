import type { Labels } from '../core/labels';
import { isDnsSubdomain, isRecord } from '../core/object';
import { NamespaceScope, namespaceScope } from '../core/scope';
import { readWorkloadEntryHealth, WorkloadEntryHealthRead } from '../core/workloadEntryHealth';
import {
  workloadEntryLabels,
  workloadEntryMatches,
  workloadLabelBudget,
} from '../core/workloadGroupEntries';
import { configurationDefinitions } from '../resources/registry';
import { readCollection } from './collections';
import { discoverConfiguration } from './configuration';
import { InvalidResponseError, withDiagnosticDeadline } from './requests';

export interface MatchingWorkloadEntry {
  name: string;
  namespace: string;
  uid: string;
  labels: Labels;
  address?: string;
  network?: string;
  serviceAccount?: string;
  health: WorkloadEntryHealthRead;
}

export async function loadWorkloadGroupEntries(
  scope: NamespaceScope,
  selector: Labels,
  signal: AbortSignal
) {
  const captured = namespaceScope(scope.cluster, scope.namespace);
  const labels = workloadEntryLabels(structuredClone(selector));
  if (!Object.keys(labels).length)
    throw new Error('A nonempty WorkloadGroup label selector is required for this lookup');
  const countLabels = workloadLabelBudget();
  countLabels(labels);
  const definition = configurationDefinitions.find(
    item => item.kind === 'WorkloadEntry' && item.group === 'networking.istio.io'
  );
  if (!definition) throw new Error('WorkloadEntry resource model is unavailable');
  return withDiagnosticDeadline(
    signal,
    'WorkloadEntry lookup exceeded 15 seconds',
    async requestSignal => {
      const available = await discoverConfiguration(captured, definition, requestSignal);
      if (available.available === false)
        throw new Error(`WorkloadEntry API unavailable: ${available.reason}`);
      const result = await readCollection(
        captured,
        {
          kind: 'WorkloadEntry',
          apiVersion: available.apiVersion,
          path: `/apis/${available.apiVersion}/namespaces/${encodeURIComponent(
            captured.namespace
          )}/workloadentries`,
        },
        value => {
          if (
            !isRecord(value.metadata) ||
            value.metadata.namespace !== captured.namespace ||
            !isDnsSubdomain(value.metadata.name) ||
            typeof value.metadata.uid !== 'string' ||
            !value.metadata.uid ||
            value.metadata.uid.trim() !== value.metadata.uid ||
            value.metadata.uid.length > 1024 ||
            !isRecord(value.spec)
          )
            throw new InvalidResponseError('Malformed or out-of-scope WorkloadEntry');
          const spec = value.spec;
          const text = (name: string): string | undefined => {
            const field = spec[name];
            if (field === undefined) return undefined;
            if (typeof field !== 'string' || field.length > 4096)
              throw new InvalidResponseError(`WorkloadEntry ${name} is malformed or oversized`);
            return field;
          };
          const entryLabels = workloadEntryLabels(spec.labels);
          countLabels(entryLabels);
          return {
            name: value.metadata.name,
            namespace: captured.namespace,
            uid: value.metadata.uid,
            labels: entryLabels,
            address: text('address'),
            network: text('network'),
            serviceAccount: text('serviceAccount'),
            health: readWorkloadEntryHealth(value.metadata.annotations, value.status),
          } satisfies MatchingWorkloadEntry;
        },
        requestSignal
      );
      return {
        scope: captured,
        selector: labels,
        examined: result.items.length,
        ...result,
        items: result.items.filter(entry => workloadEntryMatches(labels, entry.labels)),
      };
    }
  );
}
