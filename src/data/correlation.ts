import { CorrelationKind, CorrelationResource, OwnerReference } from '../core/correlation';
import { Labels } from '../core/labels';
import { isRecord } from '../core/object';
import { NamespaceScope, namespaceScope } from '../core/scope';
import { observedPodAccount } from '../core/workloadAccounts';
import { isHealthWorkloadKind, workloadHealthResource } from '../core/workloadHealth';
import {
  InvalidResponseError,
  readCluster,
  ReadFailure,
  readFailure,
  withDiagnosticDeadline,
} from './requests';
import { readVirtualWorkloadSource, VIRTUAL_WORKLOAD_SOURCE } from './virtualWorkloads';

export interface CorrelationSource {
  kind: CorrelationKind;
  group: string;
  apiVersion: string;
  plural: string;
}

export const CORRELATION_SOURCES: readonly CorrelationSource[] = [
  { kind: 'Deployment', group: 'apps', apiVersion: 'apps/v1', plural: 'deployments' },
  { kind: 'StatefulSet', group: 'apps', apiVersion: 'apps/v1', plural: 'statefulsets' },
  { kind: 'DaemonSet', group: 'apps', apiVersion: 'apps/v1', plural: 'daemonsets' },
  { kind: 'ReplicaSet', group: 'apps', apiVersion: 'apps/v1', plural: 'replicasets' },
  { kind: 'ReplicationController', group: '', apiVersion: 'v1', plural: 'replicationcontrollers' },
  { kind: 'Job', group: 'batch', apiVersion: 'batch/v1', plural: 'jobs' },
  { kind: 'CronJob', group: 'batch', apiVersion: 'batch/v1', plural: 'cronjobs' },
  { kind: 'Pod', group: '', apiVersion: 'v1', plural: 'pods' },
  { kind: 'Service', group: '', apiVersion: 'v1', plural: 'services' },
];

export interface SourceSnapshot {
  source: CorrelationSource;
  resources: CorrelationResource[];
  complete: boolean;
  resourceVersion?: string;
  error?: ReadFailure;
  limited?: boolean;
  notServed?: boolean;
}

export interface CorrelationSnapshot {
  scope: NamespaceScope;
  sources: SourceSnapshot[];
  resources: CorrelationResource[];
  complete: boolean;
}

const PAGE_SIZE = 250;
const PAGE_LIMIT = 4;
const CONCURRENCY = 3;

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) {
    throw new InvalidResponseError(`Missing or invalid ${field}`);
  }
  return value;
}

function labels(value: unknown): Labels {
  if (value === undefined || value === null) return {};
  if (!isRecord(value) || Object.values(value).some(item => typeof item !== 'string')) {
    throw new InvalidResponseError('Invalid resource labels');
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (typeof item !== 'string') throw new InvalidResponseError('Invalid label value');
      return [key, item];
    })
  );
}

function owners(value: unknown): OwnerReference[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new InvalidResponseError('Invalid owner references');
  return value.map((owner: unknown) => {
    if (!isRecord(owner)) throw new InvalidResponseError('Invalid owner reference');
    const apiVersion = requiredString(owner.apiVersion, 'owner API version');
    const segments = apiVersion.split('/');
    if (segments.length > 2 || segments.some(segment => !segment)) {
      throw new InvalidResponseError('Invalid owner API version');
    }
    if (owner.controller !== undefined && typeof owner.controller !== 'boolean') {
      throw new InvalidResponseError('Invalid controller reference');
    }
    return {
      group: segments.length === 2 ? segments[0] : '',
      kind: requiredString(owner.kind, 'owner kind'),
      name: requiredString(owner.name, 'owner name'),
      uid: requiredString(owner.uid, 'owner UID'),
      controller: owner.controller === true,
    };
  });
}

function proxyMode(spec: Record<string, unknown>): CorrelationResource['proxyMode'] {
  if (!Array.isArray(spec.containers) || spec.containers.length === 0) {
    throw new InvalidResponseError('Missing pod containers');
  }
  function containers(value: unknown): Record<string, unknown>[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.some(item => !isRecord(item))) {
      throw new InvalidResponseError('Invalid pod containers');
    }
    return value.map(item => {
      if (!isRecord(item)) throw new InvalidResponseError('Invalid pod container');
      requiredString(item.name, 'container name');
      return item;
    });
  }
  if (containers(spec.containers).some(container => container.name === 'istio-proxy'))
    return 'sidecar';
  return containers(spec.initContainers).some(
    container => container.name === 'istio-proxy' && container.restartPolicy === 'Always'
  )
    ? 'native-sidecar'
    : 'none';
}

export function decodeCorrelationResource(
  value: unknown,
  source: CorrelationSource,
  scope: NamespaceScope
): CorrelationResource {
  if (!isRecord(value) || !isRecord(value.metadata) || !isRecord(value.spec)) {
    throw new InvalidResponseError(`Invalid ${source.kind} object`);
  }
  if (
    (value.kind !== undefined && value.kind !== source.kind) ||
    (value.apiVersion !== undefined && value.apiVersion !== source.apiVersion) ||
    value.metadata.namespace !== scope.namespace
  ) {
    throw new InvalidResponseError(
      'Resource response does not match its requested kind and namespace'
    );
  }
  const objectLabels = labels(value.metadata.labels);
  const name = requiredString(value.metadata.name, 'resource name');
  let workloadLabels = objectLabels;
  if (
    ['Deployment', 'ReplicaSet', 'StatefulSet', 'DaemonSet', 'ReplicationController'].includes(
      source.kind
    )
  ) {
    if (source.kind === 'ReplicationController' && value.spec.template === undefined) {
      workloadLabels = {};
    } else {
      if (!isRecord(value.spec.template))
        throw new InvalidResponseError('Missing workload pod template');
      const metadata = value.spec.template.metadata;
      if (metadata !== undefined && !isRecord(metadata)) {
        throw new InvalidResponseError('Invalid pod-template metadata');
      }
      workloadLabels = labels(isRecord(metadata) ? metadata.labels : undefined);
    }
  }
  let health: CorrelationResource['health'];
  if (isHealthWorkloadKind(source.kind)) {
    try {
      const { replicas, stale } = workloadHealthResource(
        { ...value, kind: source.kind, apiVersion: source.apiVersion },
        { kind: source.kind, namespace: scope.namespace, name }
      );
      health = { ok: true, value: { replicas, stale } };
    } catch (error) {
      health = {
        ok: false,
        message: error instanceof Error ? error.message : 'Invalid workload health state',
      };
    }
  }
  return {
    identity: {
      cluster: scope.cluster,
      namespace: scope.namespace,
      group: source.group,
      kind: source.kind,
      name,
      uid: requiredString(value.metadata.uid, 'resource UID'),
    },
    labels: objectLabels,
    workloadLabels,
    owners: owners(value.metadata.ownerReferences),
    serviceSelector: source.kind === 'Service' ? labels(value.spec.selector) : null,
    proxyMode: source.kind === 'Pod' ? proxyMode(value.spec) : 'none',
    ...(source.kind === 'Pod' ? { podAccount: observedPodAccount(value.spec) } : {}),
    ...(typeof value.metadata.resourceVersion === 'string'
      ? { resourceVersion: value.metadata.resourceVersion }
      : {}),
    ...(health ? { health } : {}),
  };
}

export async function readCorrelationSource(
  scope: NamespaceScope,
  source: CorrelationSource,
  signal: AbortSignal
): Promise<SourceSnapshot> {
  const resources: CorrelationResource[] = [];
  const ids = new Set<string>();
  const tokens = new Set<string>();
  let continuation = '';
  let resourceVersion: string | undefined;
  const prefix = source.group ? `/apis/${source.apiVersion}` : '/api/v1';
  const path = `${prefix}/namespaces/${encodeURIComponent(scope.namespace)}/${source.plural}`;
  try {
    for (let page = 0; page < PAGE_LIMIT; page++) {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (continuation) params.set('continue', continuation);
      const response = await readCluster(scope, `${path}?${params}`, signal);
      if (
        !isRecord(response) ||
        response.kind !== `${source.kind}List` ||
        response.apiVersion !== source.apiVersion ||
        !Array.isArray(response.items) ||
        !isRecord(response.metadata)
      ) {
        throw new InvalidResponseError(`Invalid ${source.kind} list response`);
      }
      if (response.items.length > PAGE_SIZE) {
        throw new InvalidResponseError('Resource list exceeded the requested page limit');
      }
      const version = requiredString(response.metadata.resourceVersion, 'list resource version');
      if (resourceVersion !== undefined && resourceVersion !== version) {
        throw new InvalidResponseError('Resource version changed during pagination');
      }
      resourceVersion = version;
      const decoded = response.items.map(item => decodeCorrelationResource(item, source, scope));
      const next = response.metadata.continue ?? '';
      if (typeof next !== 'string' || (next && tokens.has(next))) {
        throw new InvalidResponseError('Invalid or repeated resource continuation token');
      }
      for (const resource of decoded) {
        if (ids.has(resource.identity.uid))
          throw new InvalidResponseError('Duplicate resource in list');
        ids.add(resource.identity.uid);
      }
      resources.push(...decoded);
      if (!next) return { source, resources, resourceVersion, complete: true };
      tokens.add(next);
      continuation = next;
    }
    return { source, resources, resourceVersion, complete: false, limited: true };
  } catch (error) {
    if (signal.aborted) throw error;
    return { source, resources, resourceVersion, complete: false, error: readFailure(error) };
  }
}

export async function loadCorrelationSnapshot(
  scope: NamespaceScope,
  signal: AbortSignal
): Promise<CorrelationSnapshot> {
  const captured = namespaceScope(scope.cluster, scope.namespace);
  return withDiagnosticDeadline(
    signal,
    'Namespace correlation exceeded 15 seconds',
    requestSignal => collectCorrelationSnapshot(captured, requestSignal)
  );
}

async function collectCorrelationSnapshot(
  scope: NamespaceScope,
  signal: AbortSignal
): Promise<CorrelationSnapshot> {
  const requested = [...CORRELATION_SOURCES, VIRTUAL_WORKLOAD_SOURCE];
  const results = new Map<CorrelationKind, SourceSnapshot>();
  let next = 0;
  async function worker() {
    while (next < requested.length) {
      signal.throwIfAborted();
      const source = requested[next++];
      results.set(
        source.kind,
        source.kind === 'WorkloadGroup'
          ? await readVirtualWorkloadSource(scope, signal)
          : await readCorrelationSource(scope, source, signal)
      );
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const sources = requested.map(source => {
    const result = results.get(source.kind);
    if (!result) throw new Error('Correlation source was not collected');
    return result;
  });
  return {
    scope,
    sources,
    resources: sources.flatMap(source => source.resources),
    complete: sources.every(source => source.complete),
  };
}
