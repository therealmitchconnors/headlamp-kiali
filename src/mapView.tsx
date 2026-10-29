import { Icon } from '@iconify/react';
import { K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import type { GraphNode } from '@kinvolk/headlamp-plugin/lib/components/resourceMap/graph/graphModel';
import type { GraphSource } from '@kinvolk/headlamp-plugin/lib/plugin/registry';
import { useMemo } from 'react';
import { ConfigurationDetail } from './components/configuration/Configuration';
import { configurationReferences } from './core/configuration';
import { isDnsLabel, isDnsSubdomain, isRecord } from './core/object';
import {
  workloadEntryLabels,
  workloadEntryMatches,
  workloadGroupEntrySelector,
  workloadLabelBudget,
} from './core/workloadGroupEntries';
import { configurationDefinitions } from './resources/registry';
import { WorkloadEntry } from './resources/workload-entry';

const icon = <Icon icon="mdi:routes" width="100%" height="100%" />;

function useWorkloadEntries() {
  return WorkloadEntry.useList();
}
function useServices() {
  return K8s.ResourceClasses.Service.useList();
}

export const kialiConfigurationSource: GraphSource = {
  id: 'kiali-configuration',
  label: 'Kiali configuration (not traffic)',
  icon,
  sources: configurationDefinitions.map(definition => ({
    id: `kiali-config-${definition.id}`,
    label: definition.label,
    icon,
    isEnabledByDefault: false,
    useData() {
      const { t } = useTranslation();
      const isGroup =
        definition.kind === 'WorkloadGroup' && definition.group === 'networking.istio.io';
      const edgeLabel = isGroup
        ? t('WorkloadGroup label match (not ownership)')
        : t('Configuration reference');
      const errorLabel = t('Incomplete {{kind}} topology', { kind: definition.kind });
      const [resources, resourceError] = definition.resourceClass.useList();
      const useTargets = isGroup ? useWorkloadEntries : useServices;
      const [targets, targetError] = useTargets();
      return useMemo(() => {
        if ((!resources && !resourceError) || (isGroup && !targets && !targetError)) return null;
        const shown = isGroup ? (resources ?? []).slice(0, 1000) : resources ?? [];
        const hasScope = (resource: { cluster: unknown; metadata: unknown }) => {
          const metadata = resource.metadata;
          return (
            typeof resource.cluster === 'string' &&
            !!resource.cluster &&
            isRecord(metadata) &&
            isDnsLabel(metadata.namespace) &&
            isDnsSubdomain(metadata.name) &&
            typeof metadata.uid === 'string' &&
            !!metadata.uid &&
            metadata.uid.length <= 1024 &&
            metadata.uid.trim() === metadata.uid
          );
        };
        const roots = isGroup ? shown.filter(hasScope) : shown;
        const nodes: GraphNode[] = roots.map(resource => ({
          id: resource.metadata.uid,
          kubeObject: resource,
          icon,
          detailsComponent: () => (
            <ConfigurationDetail
              definition={definition}
              name={resource.metadata.name}
              namespace={resource.metadata.namespace}
            />
          ),
        }));
        const edges: { id: string; source: string; target: string; label: string }[] = [];
        const entryDefinition = isGroup
          ? configurationDefinitions.find(
              item => item.kind === 'WorkloadEntry' && item.group === 'networking.istio.io'
            )
          : undefined;
        const edgeIds = new Set<string>();
        const nodeIds = new Set(nodes.map(node => node.id));
        const connect = (
          resource: NonNullable<typeof resources>[number],
          target: NonNullable<typeof targets>[number]
        ) => {
          if (!target.metadata.uid || !resource.metadata.uid) return;
          const id = `${resource.metadata.uid}-${target.metadata.uid}`;
          if (edgeIds.has(id)) return;
          edgeIds.add(id);
          if (!nodeIds.has(target.metadata.uid)) {
            nodeIds.add(target.metadata.uid);
            nodes.push({
              id: target.metadata.uid,
              kubeObject: target,
              ...(entryDefinition
                ? {
                    detailsComponent: () => (
                      <ConfigurationDetail
                        definition={entryDefinition}
                        name={target.metadata.name}
                        namespace={target.metadata.namespace}
                      />
                    ),
                  }
                : {}),
            });
          }
          edges.push({
            id,
            source: resource.metadata.uid,
            target: target.metadata.uid,
            label: edgeLabel,
          });
        };
        let matchingError: Error | undefined;
        if (isGroup) {
          try {
            if (!entryDefinition) throw new Error('WorkloadEntry topology model is unavailable');
            if ((resources?.length ?? 0) > 1000 || (targets?.length ?? 0) > 1000)
              throw new Error('WorkloadGroup topology is limited to 1000 groups and 1000 entries');
            if (roots.length !== shown.length)
              throw new Error('WorkloadGroup topology contains invalid resource identities');
            const countLabels = workloadLabelBudget();
            const entries = (targets ?? []).map(target => {
              if (!hasScope(target) || !('spec' in target) || !isRecord(target.spec))
                throw new Error('WorkloadEntry topology identity or specification is unavailable');
              const labels = workloadEntryLabels(target.spec.labels);
              countLabels(labels);
              return { target, labels };
            });
            let comparisons = 0;
            for (const resource of roots) {
              const selector = workloadGroupEntrySelector(resource.spec);
              if (!selector || !Object.keys(selector).length) continue;
              countLabels(selector);
              for (const { target, labels } of entries) {
                if (
                  target.cluster !== resource.cluster ||
                  target.metadata.namespace !== resource.metadata.namespace
                )
                  continue;
                if (++comparisons > 10000)
                  throw new Error('WorkloadGroup topology exceeds 10,000 entry comparisons');
                if (workloadEntryMatches(selector, labels)) connect(resource, target);
              }
            }
          } catch (error) {
            matchingError =
              error instanceof Error ? error : new Error('WorkloadGroup topology is incomplete');
          }
        } else {
          for (const resource of shown) {
            for (const reference of configurationReferences(
              resource.kind,
              resource.spec,
              resource.metadata.namespace ?? '',
              definition.group
            )) {
              if (reference.kind !== 'Service') continue;
              const target = targets?.find(
                target =>
                  target.cluster === resource.cluster &&
                  target.metadata.namespace === reference.namespace &&
                  target.metadata.name === reference.name
              );
              if (target) connect(resource, target);
            }
          }
        }
        return {
          nodes: [
            ...nodes,
            ...[resourceError, targetError, matchingError].filter(Boolean).map((error, index) => ({
              id: `kiali-config-${definition.id}-error-${index}`,
              label: errorLabel,
              subtitle: error?.message,
              status: 'warning' as const,
              icon,
            })),
          ],
          edges,
        };
      }, [resources, targets, resourceError, targetError, edgeLabel, errorLabel, isGroup]);
    },
  })),
};
