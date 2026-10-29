import type { CorrelationResource } from './correlation';
import type { Labels } from './labels';
import { isDnsSubdomain } from './object';
import { NamespaceScope, namespaceScope } from './scope';
import {
  workloadEntryLabels,
  workloadEntryMatches,
  workloadLabelBudget,
} from './workloadGroupEntries';

export interface VirtualWorkloadRecord {
  name: string;
  namespace: string;
  uid: string;
  resourceVersion: string;
  labels: Labels;
}
export interface VirtualWorkloadGroup extends VirtualWorkloadRecord {
  selector: Labels;
}

export function virtualWorkloadResources(
  scope: NamespaceScope,
  groups: readonly VirtualWorkloadGroup[],
  entries: readonly VirtualWorkloadRecord[]
): CorrelationResource[] {
  const captured = namespaceScope(scope.cluster, scope.namespace);
  if (groups.length > 1000 || entries.length > 1000)
    throw new Error('VM correlation requires at most 1000 groups and entries');
  const budget = workloadLabelBudget();
  const uids = new Set<string>();
  function validate(records: readonly VirtualWorkloadRecord[]) {
    const names = new Set<string>();
    for (const record of records) {
      if (
        record.namespace !== captured.namespace ||
        !isDnsSubdomain(record.name) ||
        typeof record.uid !== 'string' ||
        !record.uid ||
        record.uid.trim() !== record.uid ||
        record.uid.length > 1024 ||
        typeof record.resourceVersion !== 'string' ||
        !record.resourceVersion ||
        record.resourceVersion.trim() !== record.resourceVersion ||
        record.resourceVersion.length > 1024 ||
        names.has(record.name) ||
        uids.has(record.uid)
      )
        throw new Error('VM correlation has invalid, duplicate or out-of-scope identities');
      names.add(record.name);
      uids.add(record.uid);
      budget(workloadEntryLabels(record.labels));
    }
  }
  validate(groups);
  validate(entries);
  let comparisons = 0;
  return groups.map(group => {
    const selector = workloadEntryLabels(group.selector);
    budget(selector);
    const matches = !Object.keys(selector).length
      ? []
      : entries.filter(entry => {
          if (++comparisons > 10000)
            throw new Error('VM correlation exceeds 10000 entry comparisons');
          return workloadEntryMatches(selector, entry.labels);
        });
    const first = matches[0];
    return {
      identity: {
        cluster: captured.cluster,
        namespace: captured.namespace,
        group: 'networking.istio.io',
        kind: 'WorkloadGroup',
        name: group.name,
        uid: group.uid,
      },
      labels: { ...group.labels },
      workloadLabels: { ...(first ? first.labels : selector) },
      owners: [],
      serviceSelector: null,
      proxyMode: 'none',
      resourceVersion: group.resourceVersion,
      virtualMachine: {
        labelSource: first ? 'entry' : 'group',
        matchingEntries: matches.length,
        ...(first
          ? { entry: { name: first.name, uid: first.uid, resourceVersion: first.resourceVersion } }
          : {}),
      },
    };
  });
}
