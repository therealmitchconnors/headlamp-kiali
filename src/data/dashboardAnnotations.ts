import { CustomDashboardSettings, validateCustomDashboardSettings } from '../core/customDashboards';
import {
  applyDashboardAnnotationLayer,
  dashboardAnnotationEvidence,
  dashboardAnnotationPath,
  DashboardAnnotationSource,
  DashboardAnnotationTarget,
  validateDashboardAnnotationTarget,
} from '../core/dashboardAnnotations';
import { effectiveDashboardCatalog } from '../core/dashboardCatalog';
import { ClusterScope, clusterScope } from '../core/scope';
import { InvalidResponseError, readCluster, withDiagnosticDeadline } from './requests';

export async function loadDashboardAnnotations(
  scope: ClusterScope,
  settings: CustomDashboardSettings,
  target: DashboardAnnotationTarget,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const capturedScope = clusterScope(scope.cluster);
  const capturedSettings = validateCustomDashboardSettings(structuredClone(settings));
  const capturedTarget = validateDashboardAnnotationTarget(target);
  const base = effectiveDashboardCatalog(capturedSettings);
  return withDiagnosticDeadline(
    signal,
    'Dashboard annotation reads exceeded 15 seconds',
    async requestSignal => {
      let catalog = base;
      const sources: DashboardAnnotationSource[] = [];
      const targets: DashboardAnnotationTarget[] = [{ namespace: capturedTarget.namespace }];
      if (capturedTarget.workload) targets.push(capturedTarget);
      for (const item of targets) {
        const response = await readCluster(
          capturedScope,
          dashboardAnnotationPath(item),
          requestSignal
        );
        requestSignal.throwIfAborted();
        try {
          const evidence = dashboardAnnotationEvidence(response, item);
          catalog = applyDashboardAnnotationLayer(
            catalog,
            evidence.templates,
            item.workload ? 'workload' : 'namespace'
          );
          sources.push(evidence.source);
        } catch (error) {
          throw new InvalidResponseError(
            error instanceof Error ? error.message : 'Invalid dashboard annotation response'
          );
        }
      }
      return {
        cluster: capturedScope.cluster,
        settings: capturedSettings,
        target: capturedTarget,
        catalog,
        sources,
      };
    }
  );
}
