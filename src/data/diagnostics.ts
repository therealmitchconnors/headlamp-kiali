import { DiagnosticPod, diagnosticPod, podLogPath, PodLogQuery } from '../core/diagnostics';
import { isDnsLabel, isDnsSubdomain } from '../core/object';
import { ClusterScope } from '../core/scope';
import {
  InvalidResponseError,
  readCluster,
  readClusterText,
  withDiagnosticDeadline,
} from './requests';

export async function loadDiagnosticPod(
  scope: ClusterScope,
  namespace: string,
  name: string,
  signal: AbortSignal
): Promise<DiagnosticPod> {
  if (!isDnsLabel(namespace) || !isDnsSubdomain(name))
    throw new Error('A namespace and valid Pod name are required');
  const response = await readCluster(scope, `/api/v1/namespaces/${namespace}/pods/${name}`, signal);
  try {
    return diagnosticPod(response, namespace, name);
  } catch (error) {
    throw new InvalidResponseError(
      error instanceof Error ? error.message : 'Invalid diagnostic pod'
    );
  }
}
export async function loadPodLogSnapshot(
  scope: ClusterScope,
  query: PodLogQuery,
  signal: AbortSignal
) {
  const path = podLogPath(query);
  return withDiagnosticDeadline(
    signal,
    'The diagnostic log request exceeded 15 seconds',
    async requestSignal => {
      const before = await loadDiagnosticPod(scope, query.namespace, query.pod, requestSignal);
      if (before.uid !== query.uid)
        throw new Error('The pod was replaced; reload its diagnostic identity');
      const container = before.containers.find(container => container.name === query.container);
      if (!container) throw new Error('The selected container is no longer present');
      const result = await readClusterText(scope, path, requestSignal, 262144);
      const after = await loadDiagnosticPod(scope, query.namespace, query.pod, requestSignal);
      const current = after.containers.find(container => container.name === query.container);
      if (after.uid !== before.uid || !current || current.restarts !== container.restarts)
        throw new Error(
          'Pod identity or container restart count changed while reading logs; load a new snapshot'
        );
      return { ...result, pod: before, container, capturedAt: new Date().toISOString() };
    }
  );
}
