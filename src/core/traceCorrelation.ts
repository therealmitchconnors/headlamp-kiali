import { isDnsLabel, isDnsSubdomain } from './object';
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
