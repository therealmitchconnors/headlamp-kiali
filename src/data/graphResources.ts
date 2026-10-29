import {
  captureGraphResourceTarget,
  graphResourceCandidates,
  GraphResourceTarget,
} from '../core/graphResources';
import { AppLabels } from '../core/labels';
import { namespaceScope } from '../core/scope';
import { loadCorrelationSnapshot } from './correlation';
import { withDiagnosticDeadline } from './requests';

export async function loadGraphResources(
  target: GraphResourceTarget,
  labels: AppLabels | null,
  signal: AbortSignal
) {
  const captured = captureGraphResourceTarget(target);
  const capturedLabels = labels ? { ...labels } : null;
  return withDiagnosticDeadline(
    signal,
    'Graph resource lookup exceeded 15 seconds',
    async requestSignal => {
      const snapshot = await loadCorrelationSnapshot(
        namespaceScope(captured.cluster, captured.namespace),
        requestSignal
      );
      if (!snapshot.complete) {
        const failures = snapshot.sources
          .filter(source => !source.complete)
          .map(
            source =>
              `${source.source.kind}: ${source.error?.message ?? 'incomplete or limited list'}`
          );
        throw new Error(
          `Graph resource lookup requires complete supported resource lists: ${failures.join('; ')}`
        );
      }
      return {
        ...graphResourceCandidates(captured, snapshot.resources, capturedLabels),
        target: captured,
        checkedAt: new Date().toISOString(),
      };
    }
  );
}
