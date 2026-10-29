import { JSON_SCHEMA, load, YAMLException } from 'js-yaml';
import {
  CustomDashboardTemplate,
  isDashboardDisabled,
  validateCustomDashboardTemplate,
  validateDashboardCatalog,
} from './customDashboards';
import type { DashboardCatalog, DashboardOrigin } from './dashboardCatalog';
import { isDnsLabel, isDnsSubdomain, isRecord } from './object';

export const DASHBOARD_ANNOTATION = 'dashboards.kiali.io/templates';
export const DASHBOARD_WORKLOAD_KINDS = {
  Deployment: {
    api: '/apis/apps/v1',
    resource: 'deployments',
    apiVersion: 'apps/v1',
    template: true,
  },
  DaemonSet: {
    api: '/apis/apps/v1',
    resource: 'daemonsets',
    apiVersion: 'apps/v1',
    template: true,
  },
  StatefulSet: {
    api: '/apis/apps/v1',
    resource: 'statefulsets',
    apiVersion: 'apps/v1',
    template: true,
  },
  ReplicaSet: {
    api: '/apis/apps/v1',
    resource: 'replicasets',
    apiVersion: 'apps/v1',
    template: true,
  },
  ReplicationController: {
    api: '/api/v1',
    resource: 'replicationcontrollers',
    apiVersion: 'v1',
    template: true,
  },
  Pod: { api: '/api/v1', resource: 'pods', apiVersion: 'v1', template: false },
  Job: { api: '/apis/batch/v1', resource: 'jobs', apiVersion: 'batch/v1', template: false },
  CronJob: { api: '/apis/batch/v1', resource: 'cronjobs', apiVersion: 'batch/v1', template: false },
} as const;
export type DashboardWorkloadKind = keyof typeof DASHBOARD_WORKLOAD_KINDS;
export interface DashboardAnnotationTarget {
  namespace: string;
  workload?: { kind: DashboardWorkloadKind; name: string };
}
export interface DashboardAnnotationSource {
  kind: string;
  name: string;
  namespace: string;
  uid: string;
  resourceVersion: string;
  location: 'resource' | 'pod-template';
  annotationPresent: boolean;
  definitions: string[];
}

export function validateDashboardAnnotationTarget(
  value: DashboardAnnotationTarget
): DashboardAnnotationTarget {
  if (!isDnsLabel(value.namespace))
    throw new Error('Choose an explicit Kubernetes namespace for dashboard annotations');
  if (
    value.workload &&
    (!Object.prototype.hasOwnProperty.call(DASHBOARD_WORKLOAD_KINDS, value.workload.kind) ||
      !isDnsSubdomain(value.workload.name))
  )
    throw new Error('Choose a supported workload kind and valid name for dashboard annotations');
  return structuredClone(value);
}
export function dashboardAnnotationPath(target: DashboardAnnotationTarget): string {
  validateDashboardAnnotationTarget(target);
  if (!target.workload) return `/api/v1/namespaces/${target.namespace}`;
  const type = DASHBOARD_WORKLOAD_KINDS[target.workload.kind];
  return `${type.api}/namespaces/${target.namespace}/${type.resource}/${target.workload.name}`;
}

export function parseDashboardAnnotation(value: unknown): CustomDashboardTemplate[] {
  if (
    typeof value !== 'string' ||
    value.length > 65536 ||
    new TextEncoder().encode(value).length > 65536
  )
    throw new Error('Dashboard annotation must be a YAML string within 64 KiB');
  let parsed: unknown;
  try {
    parsed = load(value, { schema: JSON_SCHEMA });
  } catch (error) {
    if (error instanceof YAMLException)
      throw new Error(
        `Invalid dashboard annotation YAML${error.mark ? ` at line ${error.mark.line + 1}` : ''}`
      );
    if (error instanceof RangeError)
      throw new Error('Dashboard annotation YAML exceeds parser complexity limits');
    throw error;
  }
  const seen = new Set<object>();
  let nodes = 0;
  const inspect = (item: unknown, depth: number) => {
    if (++nodes > 8192 || depth > 16)
      throw new Error('Dashboard annotation exceeds structural complexity limits');
    if (item !== null && typeof item === 'object') {
      if (seen.has(item))
        throw new Error('Dashboard annotation aliases and cycles are not supported');
      seen.add(item);
      for (const child of Object.values(item)) inspect(child, depth + 1);
    }
  };
  inspect(parsed, 0);
  if (!Array.isArray(parsed) || parsed.length > 20)
    throw new Error(
      'Dashboard annotation requires a YAML list of at most 20 definitions; use [] for no overrides'
    );
  const definitions = parsed.map(validateCustomDashboardTemplate);
  if (JSON.stringify(definitions).length > 65536)
    throw new Error('Normalized dashboard annotation exceeds 64 KiB');
  return definitions;
}

export function dashboardAnnotationEvidence(
  value: unknown,
  target: DashboardAnnotationTarget
): {
  source: DashboardAnnotationSource;
  templates: CustomDashboardTemplate[];
} {
  validateDashboardAnnotationTarget(target);
  const kind = target.workload?.kind ?? 'Namespace';
  const name = target.workload?.name ?? target.namespace;
  const apiVersion = target.workload
    ? DASHBOARD_WORKLOAD_KINDS[target.workload.kind].apiVersion
    : 'v1';
  if (
    !isRecord(value) ||
    value.kind !== kind ||
    value.apiVersion !== apiVersion ||
    !isRecord(value.metadata) ||
    value.metadata.name !== name ||
    (target.workload
      ? value.metadata.namespace !== target.namespace
      : value.metadata.namespace !== undefined && value.metadata.namespace !== '')
  )
    throw new Error(
      'Dashboard annotation resource does not match the requested identity and scope'
    );
  const metadata = value.metadata;
  const identity = (field: 'uid' | 'resourceVersion') => {
    const text = metadata[field];
    if (typeof text !== 'string' || !text || text.length > 1024 || text.trim() !== text)
      throw new Error(`Dashboard annotation resource ${field} is missing or malformed`);
    return text;
  };
  const uid = identity('uid');
  const resourceVersion = identity('resourceVersion');
  let annotations: unknown = metadata.annotations;
  let location: DashboardAnnotationSource['location'] = 'resource';
  if (target.workload && DASHBOARD_WORKLOAD_KINDS[target.workload.kind].template) {
    if (!isRecord(value.spec) || !isRecord(value.spec.template))
      throw new Error('Workload pod template is unavailable for dashboard annotation selection');
    const templateMetadata = value.spec.template.metadata;
    if (templateMetadata !== undefined && templateMetadata !== null && !isRecord(templateMetadata))
      throw new Error('Workload pod-template metadata is malformed');
    if (
      isRecord(templateMetadata) &&
      templateMetadata.annotations !== undefined &&
      templateMetadata.annotations !== null
    ) {
      annotations = templateMetadata.annotations;
      location = 'pod-template';
    }
  }
  if (annotations !== undefined && annotations !== null && !isRecord(annotations))
    throw new Error('Dashboard annotation map is malformed');
  const present =
    isRecord(annotations) &&
    Object.prototype.hasOwnProperty.call(annotations, DASHBOARD_ANNOTATION);
  const templates = present ? parseDashboardAnnotation(annotations[DASHBOARD_ANNOTATION]) : [];
  return {
    source: {
      kind,
      name,
      namespace: target.namespace,
      uid,
      resourceVersion,
      location,
      annotationPresent: present,
      definitions: templates.map(template => template.name),
    },
    templates,
  };
}

export function applyDashboardAnnotationLayer(
  base: DashboardCatalog,
  definitions: readonly CustomDashboardTemplate[],
  origin: 'namespace' | 'workload'
): DashboardCatalog {
  if (definitions.length > 20) throw new Error('Dashboard annotation layer exceeds 20 definitions');
  const templates = new Map(
    base.templates.map(template => [template.name, structuredClone(template)])
  );
  const origins = new Map<string, DashboardOrigin>(base.origins);
  const disabled = new Set(base.disabled);
  for (const raw of definitions) {
    const template = validateCustomDashboardTemplate(raw);
    if (isDashboardDisabled(template)) {
      templates.delete(template.name);
      origins.delete(template.name);
      disabled.add(template.name);
    } else {
      templates.set(template.name, template);
      origins.set(template.name, origin);
      disabled.delete(template.name);
    }
  }
  return {
    templates: validateDashboardCatalog([...templates.values()]),
    origins,
    disabled: [...disabled],
  };
}
