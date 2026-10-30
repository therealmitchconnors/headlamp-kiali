import {
  ApplicationDashboardEvidence,
  applicationDashboardSelectors,
  captureApplicationDashboardEvidence,
} from './applicationDashboards';
import { correlateResources, CorrelationResource } from './correlation';
import {
  DASHBOARD_WORKLOAD_KINDS,
  DashboardWorkloadKind,
  validateDashboardAnnotationTarget,
} from './dashboardAnnotations';
import { AppLabels, isLabelKey, isLabelValue, VERSION_LABELS } from './labels';
import { NamespaceScope, namespaceScope } from './scope';

export function workloadDashboardSelectors(
  app: string,
  version: string,
  labels?: AppLabels | null
) {
  const selectors = applicationDashboardSelectors(app, labels);
  if (!isLabelValue(version)) throw new Error('Workload dashboard version label is invalid');
  if (!version) return selectors;
  const versions = labels?.app && labels.version ? [labels.version] : [...VERSION_LABELS];
  return selectors.map((selector, index) => {
    const versionLabel = versions[index];
    if (!isLabelKey(versionLabel)) throw new Error('Workload version label key is invalid');
    const metricVersionLabel = versionLabel.replace(/[^a-zA-Z0-9_]/g, '_');
    if (metricVersionLabel === selector.metricLabel)
      throw new Error('Application and version metric labels collide after sanitization');
    return {
      ...selector,
      versionLabel,
      metricVersionLabel,
      filters: { ...selector.filters, [metricVersionLabel]: version },
    };
  });
}

export function captureWorkloadDashboardEvidence(
  scope: NamespaceScope,
  resources: readonly CorrelationResource[],
  complete: boolean,
  target: { kind: DashboardWorkloadKind; name: string; uid?: string },
  labels?: AppLabels | null
): ApplicationDashboardEvidence {
  namespaceScope(scope.cluster, scope.namespace);
  validateDashboardAnnotationTarget({ namespace: scope.namespace, workload: target });
  if (resources.length > 10000)
    throw new Error('Workload dashboard snapshot exceeds its resource budget');
  const selected = resources.filter(
    resource =>
      resource.identity.cluster === scope.cluster &&
      resource.identity.namespace === scope.namespace &&
      resource.identity.kind === target.kind &&
      resource.identity.name === target.name
  );
  if (selected.length !== 1)
    throw new Error('Selected workload is missing or ambiguous in the captured snapshot');
  const resource = selected[0];
  const group = DASHBOARD_WORKLOAD_KINDS[target.kind].apiVersion.split('/').slice(0, -1).join('/');
  if (
    resource.identity.group !== group ||
    (target.uid !== undefined && target.uid !== resource.identity.uid)
  )
    throw new Error('Selected workload no longer matches the requested API group or UID');
  const identity = (value: unknown): string => {
    if (typeof value !== 'string' || !value || value.length > 1024 || value.trim() !== value)
      throw new Error('Selected workload requires a captured UID and resource version');
    return value;
  };
  const uid = identity(resource.identity.uid);
  const resourceVersion = identity(resource.resourceVersion);
  // Root this read-only projection at the selected controller, even when it has a parent.
  const correlation = correlateResources(
    resources.map(item => (item === resource ? { ...item, owners: [] } : item)),
    labels
  );
  const workload = correlation.workloads.find(
    item =>
      item.identity.uid === resource.identity.uid &&
      item.identity.cluster === scope.cluster &&
      item.identity.namespace === scope.namespace
  );
  if (!workload || !workload.app?.value)
    throw new Error('Workload dashboard inspection requires a nonempty application label');
  workload.resource = resource;
  const evidence = captureApplicationDashboardEvidence(
    {
      id: JSON.stringify(resource.identity),
      name: workload.app.value,
      cluster: scope.cluster,
      namespace: scope.namespace,
      versions: [workload.version?.value ?? null],
      workloads: [workload],
      services: workload.services,
      pods: workload.pods,
    },
    complete && correlation.issues.length === 0,
    labels
  );
  const version = workload.version?.value ?? '';
  return {
    ...evidence,
    selectors: workloadDashboardSelectors(workload.app.value, version, labels),
    workload: { kind: target.kind, name: target.name, uid, resourceVersion, version },
  };
}
