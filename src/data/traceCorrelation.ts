import { ClusterScope,clusterScope } from '../core/scope';
import { ReportedPodIdentity, tracePodIdentity } from '../core/traceCorrelation';
import { loadDiagnosticPod } from './diagnostics';
import { withDiagnosticDeadline } from './requests';

export async function verifyTracePod(
  scope: ClusterScope,
  reference: ReportedPodIdentity,
  signal: AbortSignal
) {
  const target = tracePodIdentity(reference.namespace, reference.name, reference.uid);
  const capturedScope = clusterScope(scope.cluster);
  return withDiagnosticDeadline(
    signal,
    'The reported Pod check exceeded 15 seconds',
    async requestSignal => {
      const pod = await loadDiagnosticPod(
        capturedScope,
        target.namespace,
        target.name,
        requestSignal
      );
      if (pod.uid !== target.uid)
        throw new Error('The reported Pod UID does not match the current Pod; no link was created');
      return { ...target, cluster: capturedScope.cluster, checkedAt: new Date().toISOString() };
    }
  );
}
