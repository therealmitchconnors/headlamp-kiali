import type { CorrelationResource } from '../core/correlation';
import { dashboardAnnotationPath, DashboardWorkloadKind } from '../core/dashboardAnnotations';
import { isRecord } from '../core/object';
import type { NamespaceScope } from '../core/scope';
import { namespaceScope } from '../core/scope';
import {
  CorrelationSnapshot,
  CorrelationSource,
  loadCorrelationSnapshot,
  SourceSnapshot,
} from './correlation';
import { InvalidResponseError, readCluster, withDiagnosticDeadline } from './requests';

const DEPLOYMENT_CONFIG_SOURCE: CorrelationSource = {
  kind: 'DeploymentConfig',
  group: 'apps.openshift.io',
  apiVersion: 'apps.openshift.io/v1',
  plural: 'deploymentconfigs',
};

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value || value.length > 1024 || value.trim() !== value)
    throw new InvalidResponseError(`Missing or invalid DeploymentConfig ${field}`);
  return value;
}

function labels(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value) || Object.values(value).some(item => typeof item !== 'string'))
    throw new InvalidResponseError('Invalid DeploymentConfig labels');
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') throw new InvalidResponseError('Invalid DeploymentConfig label');
    result[key] = item;
  }
  return result;
}

function deploymentConfigResource(
  value: unknown,
  scope: NamespaceScope,
  targetName: string
): CorrelationResource {
  if (
    !isRecord(value) ||
    value.kind !== 'DeploymentConfig' ||
    value.apiVersion !== DEPLOYMENT_CONFIG_SOURCE.apiVersion ||
    !isRecord(value.metadata) ||
    value.metadata.namespace !== scope.namespace ||
    value.metadata.name !== targetName ||
    !isRecord(value.spec) ||
    !isRecord(value.spec.template)
  )
    throw new InvalidResponseError(
      'DeploymentConfig response does not match the requested identity and scope'
    );
  const metadata = value.metadata;
  const templateMetadata = value.spec.template.metadata;
  if (templateMetadata !== undefined && templateMetadata !== null && !isRecord(templateMetadata))
    throw new InvalidResponseError('Invalid DeploymentConfig pod-template metadata');
  const workloadLabels = labels(isRecord(templateMetadata) ? templateMetadata.labels : undefined);
  return {
    identity: {
      cluster: scope.cluster,
      namespace: scope.namespace,
      group: DEPLOYMENT_CONFIG_SOURCE.group,
      kind: 'DeploymentConfig',
      name: string(metadata.name, 'name'),
      uid: string(metadata.uid, 'UID'),
    },
    apiVersion: DEPLOYMENT_CONFIG_SOURCE.apiVersion,
    resourceVersion: string(metadata.resourceVersion, 'resource version'),
    labels: labels(metadata.labels),
    workloadLabels,
    owners: [],
    serviceSelector: null,
    proxyMode: 'none',
  };
}

export async function loadWorkloadDashboardSnapshot(
  requested: NamespaceScope,
  target: { kind: DashboardWorkloadKind; name: string },
  signal: AbortSignal
): Promise<CorrelationSnapshot> {
  const scope = namespaceScope(requested.cluster, requested.namespace);
  if (target.kind !== 'DeploymentConfig') return loadCorrelationSnapshot(scope, signal);
  return withDiagnosticDeadline(
    signal,
    'DeploymentConfig dashboard evidence exceeded 15 seconds',
    async requestSignal => {
      const snapshot = await loadCorrelationSnapshot(scope, requestSignal);
      const path = dashboardAnnotationPath({ namespace: scope.namespace, workload: target });
      const resource = deploymentConfigResource(
        await readCluster(scope, path, requestSignal),
        scope,
        target.name
      );
      const source: SourceSnapshot = {
        source: DEPLOYMENT_CONFIG_SOURCE,
        resources: [resource],
        complete: true,
        resourceVersion: resource.resourceVersion,
      };
      return {
        ...snapshot,
        resources: [...snapshot.resources, resource],
        sources: [...snapshot.sources, source],
      };
    }
  );
}
