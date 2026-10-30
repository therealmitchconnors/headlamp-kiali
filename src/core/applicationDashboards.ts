import type { Application } from './correlation';
import type { DashboardWorkloadKind } from './dashboardAnnotations';
import type { DashboardCatalog } from './dashboardCatalog';
import { trimGoSpace } from './goStrings';
import { APP_LABELS, AppLabels, isLabelKey, isLabelValue } from './labels';
import { isDnsLabel, isDnsSubdomain, isRecord } from './object';
import { clusterScope } from './scope';

export type PodDashboardReferences =
  | { ok: true; refs: string[]; bytes: number }
  | { ok: false; message: string };
export interface ApplicationDashboardSelector {
  label: string;
  metricLabel: string;
  filters: Record<string, string>;
  versionLabel?: string;
  metricVersionLabel?: string;
}
export interface ApplicationDashboardEvidence {
  cluster: string;
  namespace: string;
  application: string;
  complete: boolean;
  pods: { name: string; uid: string; resourceVersion: string; refs: string[] }[];
  refs: string[];
  selectors: ApplicationDashboardSelector[];
  workload?: {
    kind: DashboardWorkloadKind;
    name: string;
    uid: string;
    resourceVersion: string;
    version: string;
  };
}
export interface ApplicationDashboardRef {
  name: string;
  title: string;
  runtime: string;
  selector?: ApplicationDashboardSelector;
}

export function observedPodDashboardReferences(value: unknown): PodDashboardReferences {
  try {
    if (value !== undefined && value !== null && !isRecord(value))
      throw new Error('Pod dashboard annotation map is malformed');
    const refs = new Set<string>();
    let bytes = 0;
    for (const key of ['kiali.io/runtimes', 'kiali.io/dashboards']) {
      if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, key)) continue;
      const raw = value[key];
      if (
        typeof raw !== 'string' ||
        raw.length > 4096 ||
        new TextEncoder().encode(raw).length > 4096
      )
        throw new Error('Each Pod dashboard-reference annotation must be a string within 4 KiB');
      bytes += new TextEncoder().encode(raw).length;
      for (const part of raw.split(',')) {
        const name = trimGoSpace(part);
        if (!name) continue;
        if (name.length > 128 || /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.exec(name)?.[0] !== name)
          throw new Error('Pod dashboard references must be bounded template names');
        refs.add(name);
        if (refs.size > 64) throw new Error('Pod dashboard references exceed 64 names');
      }
    }
    return { ok: true, refs: [...refs], bytes };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Pod dashboard references are unavailable',
    };
  }
}

export function applicationDashboardSelectors(
  application: string,
  labels?: AppLabels | null
): ApplicationDashboardSelector[] {
  if (!isLabelValue(application) || !application)
    throw new Error('Application dashboard inspection requires a nonempty application label');
  const keys = labels?.app && labels.version ? [labels.app] : [...APP_LABELS];
  return keys.map(label => {
    if (!isLabelKey(label)) throw new Error('Application label key is invalid');
    const metricLabel = label.replace(/[^a-zA-Z0-9_]/g, '_');
    return { label, metricLabel, filters: { [metricLabel]: application } };
  });
}

export function captureApplicationDashboardEvidence(
  app: Application,
  complete: boolean,
  labels?: AppLabels | null
): ApplicationDashboardEvidence {
  clusterScope(app.cluster);
  if (!isDnsLabel(app.namespace) || app.pods.length > 1000)
    throw new Error('Application dashboard evidence requires a bounded namespace Pod snapshot');
  const selectors = applicationDashboardSelectors(app.name, labels);
  if (!app.workloads.length || app.workloads.length > 10000)
    throw new Error('Application workload evidence is missing or exceeds its snapshot budget');
  const owned = new Set<string>();
  for (const workload of app.workloads) {
    if (
      workload.identity.cluster !== app.cluster ||
      workload.identity.namespace !== app.namespace ||
      workload.app?.value !== app.name ||
      !selectors.some(selector => selector.label === workload.app?.key)
    )
      throw new Error(
        'Application workload labels do not match the captured scope and label policy'
      );
    for (const pod of workload.pods) {
      if (
        pod.identity.cluster !== app.cluster ||
        pod.identity.namespace !== app.namespace ||
        pod.identity.kind !== 'Pod'
      )
        throw new Error('Application workload contains mismatched Pod evidence');
      const key = JSON.stringify([pod.identity.uid, pod.identity.name]);
      if (owned.has(key)) throw new Error('Application Pod ownership is duplicated');
      owned.add(key);
    }
  }
  const seen = new Set<string>();
  const names = new Set<string>();
  const refs = new Set<string>();
  let bytes = 0;
  const pods = app.pods.map(pod => {
    const identity = pod.identity;
    if (
      identity.kind !== 'Pod' ||
      identity.cluster !== app.cluster ||
      identity.namespace !== app.namespace ||
      !isDnsSubdomain(identity.name) ||
      typeof identity.uid !== 'string' ||
      !identity.uid ||
      identity.uid.length > 1024 ||
      identity.uid.trim() !== identity.uid ||
      typeof pod.resourceVersion !== 'string' ||
      !pod.resourceVersion ||
      pod.resourceVersion.length > 1024 ||
      pod.resourceVersion.trim() !== pod.resourceVersion ||
      seen.has(identity.uid) ||
      names.has(identity.name) ||
      !owned.has(JSON.stringify([identity.uid, identity.name]))
    )
      throw new Error('Application Pod evidence has invalid or duplicate scoped identity');
    seen.add(identity.uid);
    names.add(identity.name);
    if (!pod.dashboardRefs || pod.dashboardRefs.ok === false)
      throw new Error(
        pod.dashboardRefs?.ok === false
          ? pod.dashboardRefs.message
          : 'Pod dashboard annotations were not collected'
      );
    bytes += pod.dashboardRefs.bytes;
    if (!Number.isSafeInteger(bytes) || bytes > 65536)
      throw new Error('Application dashboard reference evidence exceeds 64 KiB');
    for (const ref of pod.dashboardRefs.refs) refs.add(ref);
    if (refs.size > 64)
      throw new Error('Application dashboard references exceed 64 distinct names');
    return {
      name: identity.name,
      uid: identity.uid,
      resourceVersion: pod.resourceVersion,
      refs: [...pod.dashboardRefs.refs],
    };
  });
  if (owned.size !== pods.length)
    throw new Error('Application Pod evidence does not cover its captured workload ownership');
  return {
    cluster: app.cluster,
    namespace: app.namespace,
    application: app.name,
    complete,
    pods,
    refs: [...refs],
    selectors,
  };
}

export function explicitApplicationDashboards(
  evidence: ApplicationDashboardEvidence,
  catalog: DashboardCatalog
) {
  const templates = new Map(catalog.templates.map(template => [template.name, template]));
  const unknown: string[] = [];
  const refs: ApplicationDashboardRef[] = [];
  for (const name of evidence.refs) {
    const template = templates.get(name);
    if (!template) unknown.push(name);
    else refs.push({ name, title: template.title, runtime: template.runtime ?? '' });
  }
  return { refs, unknown };
}
