import { AppLabels } from '../core/labels';
import { ClusterScope, clusterScope, namespaceScope } from '../core/scope';
import {
  ReportedPodIdentity,
  traceCurrentWorkload,
  tracePodIdentity,
} from '../core/traceCorrelation';
import { loadCorrelationSnapshot } from './correlation';
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

export async function verifyTraceWorkload(
  scope: ClusterScope,
  reference: ReportedPodIdentity,
  labels: AppLabels | null,
  signal: AbortSignal
) {
  const target = tracePodIdentity(reference.namespace, reference.name, reference.uid);
  const capturedScope = namespaceScope(scope.cluster, target.namespace);
  const capturedLabels = labels ? structuredClone(labels) : null;
  return withDiagnosticDeadline(
    signal,
    'The reported Pod workload check exceeded 15 seconds',
    async requestSignal => {
      const snapshot = await loadCorrelationSnapshot(capturedScope, requestSignal);
      if (!snapshot.complete) {
        const failures = snapshot.sources
          .filter(source => !source.complete)
          .map(
            source => `${source.source.kind}: ${source.error?.message ?? 'incomplete snapshot'}`
          );
        throw new Error(
          `Complete namespace resource lists are required to verify current workload ownership${
            failures.length ? ` (${failures.join('; ')})` : ''
          }`
        );
      }
      const current = traceCurrentWorkload(
        capturedScope,
        target,
        snapshot.resources,
        capturedLabels
      );
      return {
        reportedPod: target,
        ...current,
        cluster: capturedScope.cluster,
        namespace: capturedScope.namespace,
        checkedAt: new Date().toISOString(),
      };
    }
  );
}
