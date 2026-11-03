import {
  CorrelatedWorkload,
  correlateResources,
  CorrelationKind,
  CorrelationResource,
} from './correlation';
import { AppLabels } from './labels';
import { isDnsLabel, isDnsSubdomain } from './object';
import { NamespaceScope } from './scope';
import { TraceSpan } from './tracing';

export interface ReportedPodIdentity {
  namespace: string;
  name: string;
  uid: string;
}
export type TracePodReference =
  | {
      status: 'ready';
      identity: Readonly<ReportedPodIdentity>;
      origin: 'resource' | 'span' | 'mixed';
    }
  | { status: 'unavailable'; reason: 'absent' | 'incomplete' | 'conflicting' | 'invalid' };

export interface TraceCurrentWorkload {
  pod: Readonly<CorrelationResource['identity'] & { kind: 'Pod' }>;
  workload: Readonly<
    CorrelationResource['identity'] & {
      kind: Extract<
        CorrelationResource['identity']['kind'],
        'Deployment' | 'StatefulSet' | 'DaemonSet' | 'ReplicaSet' | 'Job' | 'CronJob'
      >;
    }
  >;
  application?: { cluster: string; namespace: string; name: string };
}

type TraceWorkloadKind = TraceCurrentWorkload['workload']['kind'];
const TRACE_WORKLOAD_KINDS = new Set<TraceWorkloadKind>([
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'ReplicaSet',
  'Job',
  'CronJob',
]);

function isTraceWorkloadKind(kind: CorrelationKind): kind is TraceWorkloadKind {
  return TRACE_WORKLOAD_KINDS.has(kind as TraceWorkloadKind);
}

export function tracePodIdentity(
  namespace: unknown,
  name: unknown,
  uid: unknown
): Readonly<ReportedPodIdentity> {
  if (
    !isDnsLabel(namespace) ||
    namespace.trim() !== namespace ||
    !isDnsSubdomain(name) ||
    name.trim() !== name ||
    typeof uid !== 'string' ||
    !uid ||
    uid.length > 256 ||
    uid.trim() !== uid
  )
    throw new Error('A valid reported Pod namespace, name and UID are required');
  return Object.freeze({ namespace, name, uid });
}

export function traceCurrentWorkload(
  scope: NamespaceScope,
  reported: ReportedPodIdentity,
  resources: readonly CorrelationResource[],
  labels?: AppLabels | null
): TraceCurrentWorkload {
  const target = tracePodIdentity(reported.namespace, reported.name, reported.uid);
  if (
    resources.some(
      resource =>
        resource.identity.cluster !== scope.cluster ||
        resource.identity.namespace !== scope.namespace
    )
  )
    throw new Error('Current workload snapshot contains resources outside the captured scope');

  const sameNamePods = resources.filter(
    (
      resource
    ): resource is CorrelationResource & {
      identity: CorrelationResource['identity'] & { kind: 'Pod' };
    } =>
      resource.identity.kind === 'Pod' &&
      resource.identity.namespace === target.namespace &&
      resource.identity.name === target.name
  );
  const currentPods = sameNamePods.filter(resource => resource.identity.uid === target.uid);
  if (currentPods.length !== 1) {
    throw new Error(
      sameNamePods.length
        ? 'The reported Pod was replaced; its current UID does not match'
        : 'The reported Pod is not present in the current namespace snapshot'
    );
  }

  const correlated = correlateResources(resources, labels);
  if (correlated.issues.length)
    throw new Error('Complete UID-based workload ownership could not be established');
  const pod = currentPods[0];
  const matches = correlated.workloads.filter(
    (
      item
    ): item is CorrelatedWorkload & {
      identity: CorrelationResource['identity'] & { kind: TraceWorkloadKind };
    } =>
      isTraceWorkloadKind(item.identity.kind) &&
      item.pods.some(
        current =>
          current.identity.cluster === pod.identity.cluster &&
          current.identity.namespace === pod.identity.namespace &&
          current.identity.uid === pod.identity.uid
      )
  );
  if (matches.length !== 1)
    throw new Error('The current Pod has no unique supported workload owner');

  const workload = matches[0];
  const application = correlated.applications.find(item =>
    item.workloads.some(
      current =>
        current.identity.cluster === workload.identity.cluster &&
        current.identity.namespace === workload.identity.namespace &&
        current.identity.uid === workload.identity.uid
    )
  );
  return Object.freeze({
    pod: Object.freeze({ ...pod.identity }),
    workload: Object.freeze({ ...workload.identity }),
    ...(application
      ? {
          application: Object.freeze({
            cluster: application.cluster,
            namespace: application.namespace,
            name: application.name,
          }),
        }
      : {}),
  });
}

export function reportedTracePod(
  span: Pick<TraceSpan, 'attributes' | 'resourceAttributes'>
): TracePodReference {
  if (span.attributes.length > 256 || span.resourceAttributes.length > 256)
    return { status: 'unavailable', reason: 'invalid' };
  const keys = ['k8s.namespace.name', 'k8s.pod.name', 'k8s.pod.uid'];
  const values = new Map<string, Set<string>>();
  const origins = new Set<'resource' | 'span'>();
  for (const [source, attributes] of [
    ['resource', span.resourceAttributes],
    ['span', span.attributes],
  ] as const) {
    for (const attribute of attributes) {
      if (!keys.includes(attribute.key)) continue;
      if (typeof attribute.value !== 'string') return { status: 'unavailable', reason: 'invalid' };
      const current = values.get(attribute.key) ?? new Set<string>();
      current.add(attribute.value);
      values.set(attribute.key, current);
      origins.add(source);
    }
  }
  if (!values.size) return { status: 'unavailable', reason: 'absent' };
  if ([...values.values()].some(values => values.size > 1))
    return { status: 'unavailable', reason: 'conflicting' };
  if (keys.some(key => !values.has(key))) return { status: 'unavailable', reason: 'incomplete' };
  const [namespace, name, uid] = keys.map(key => [...(values.get(key) ?? [])][0]);
  try {
    return {
      status: 'ready',
      identity: tracePodIdentity(namespace, name, uid),
      origin: origins.size > 1 ? 'mixed' : origins.has('resource') ? 'resource' : 'span',
    };
  } catch {
    return { status: 'unavailable', reason: 'invalid' };
  }
}
