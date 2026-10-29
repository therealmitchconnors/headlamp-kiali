import { isDnsLabel, isDnsSubdomain, isRecord } from './object';

export interface DiagnosticPod {
  namespace: string;
  name: string;
  uid: string;
  containers: {
    name: string;
    type: 'regular' | 'init' | 'ephemeral';
    nativeSidecar: boolean;
    ready: boolean | null;
    restarts: number | null;
  }[];
}
export interface PodLogQuery {
  namespace: string;
  pod: string;
  uid: string;
  container: string;
  tailLines: number;
  previous: boolean;
  sinceSeconds: number;
}
export function diagnosticPod(value: unknown, namespace: string, name: string): DiagnosticPod {
  if (
    !isDnsLabel(namespace) ||
    !isDnsSubdomain(name) ||
    !isRecord(value) ||
    value.apiVersion !== 'v1' ||
    value.kind !== 'Pod' ||
    !isRecord(value.metadata) ||
    value.metadata.name !== name ||
    value.metadata.namespace !== namespace ||
    typeof value.metadata.uid !== 'string' ||
    !value.metadata.uid ||
    !isRecord(value.spec) ||
    !Array.isArray(value.spec.containers) ||
    !value.spec.containers.length
  )
    throw new Error('Pod response does not match the requested diagnostic identity');
  if (value.status !== undefined && !isRecord(value.status))
    throw new Error('Malformed pod status');
  const status = isRecord(value.status) ? value.status : {};
  const containers: DiagnosticPod['containers'] = [];
  const names = new Set<string>();
  for (const [field, stateField, type] of [
    ['containers', 'containerStatuses', 'regular'],
    ['initContainers', 'initContainerStatuses', 'init'],
    ['ephemeralContainers', 'ephemeralContainerStatuses', 'ephemeral'],
  ] as const) {
    const entries = value.spec[field] ?? [];
    const states = status[stateField] ?? [];
    if (
      !Array.isArray(entries) ||
      !Array.isArray(states) ||
      entries.length > 100 ||
      states.length > 100
    )
      throw new Error('Invalid or oversized container inventory');
    if (
      states.some(
        state =>
          !isRecord(state) ||
          !isDnsLabel(state.name) ||
          (state.ready !== undefined && typeof state.ready !== 'boolean') ||
          (state.restartCount !== undefined &&
            (typeof state.restartCount !== 'number' ||
              !Number.isSafeInteger(state.restartCount) ||
              state.restartCount < 0))
      )
    )
      throw new Error('Malformed diagnostic container status');
    for (const entry of entries) {
      if (!isRecord(entry) || !isDnsLabel(entry.name) || names.has(entry.name))
        throw new Error('Invalid or duplicate diagnostic container name');
      names.add(entry.name);
      const matches = states.filter(state => isRecord(state) && state.name === entry.name);
      if (matches.length > 1) throw new Error('Ambiguous diagnostic container status');
      const state = matches[0];
      const restarts = isRecord(state) ? state.restartCount : undefined;
      containers.push({
        name: entry.name,
        type,
        nativeSidecar: type === 'init' && entry.restartPolicy === 'Always',
        ready: isRecord(state) && typeof state.ready === 'boolean' ? state.ready : null,
        restarts:
          typeof restarts === 'number' && Number.isSafeInteger(restarts) && restarts >= 0
            ? restarts
            : null,
      });
    }
  }
  if (containers.length > 100)
    throw new Error('Diagnostic container inventory exceeds 100 entries');
  return { namespace, name, uid: value.metadata.uid, containers };
}
export function podLogPath(query: PodLogQuery): string {
  if (
    !isDnsLabel(query.namespace) ||
    !isDnsSubdomain(query.pod) ||
    !query.uid ||
    !isDnsLabel(query.container) ||
    !Number.isInteger(query.tailLines) ||
    query.tailLines < 1 ||
    query.tailLines > 1000 ||
    typeof query.previous !== 'boolean' ||
    !Number.isInteger(query.sinceSeconds) ||
    query.sinceSeconds < 1 ||
    query.sinceSeconds > 86400
  )
    throw new Error(
      'Select a captured pod/container, 1..1000 log lines and a lookback of at most 24 hours'
    );
  const params = new URLSearchParams({
    container: query.container,
    tailLines: String(query.tailLines),
    previous: String(query.previous),
    sinceSeconds: String(query.sinceSeconds),
    timestamps: 'true',
    follow: 'false',
    limitBytes: '262144',
  });
  return `/api/v1/namespaces/${query.namespace}/pods/${query.pod}/log?${params}`;
}
