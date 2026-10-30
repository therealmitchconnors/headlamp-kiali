import {
  ApplicationDashboardEvidence,
  ApplicationDashboardRef,
  ApplicationDashboardSelector,
  explicitApplicationDashboards,
} from '../core/applicationDashboards';
import { ClusterConfig } from '../core/config';
import { CustomDashboardScopeQuery } from '../core/customDashboards';
import {
  DashboardDiscoveryQuery,
  dashboardDiscoveryRequest,
  DashboardRuntime,
} from '../core/dashboardDiscovery';
import { compareGoStrings } from '../core/goStrings';
import { clusterScope } from '../core/scope';
import { loadDashboardAnnotations } from './dashboardAnnotations';
import { discoverCustomDashboards } from './dashboardDiscovery';
import { InvalidResponseError, ReadFailure, readFailure, withDiagnosticDeadline } from './requests';

export type ApplicationDashboardDeferral =
  | 'incomplete'
  | 'disabled'
  | 'threshold'
  | 'no-definitions'
  | 'no-provider';

export async function inspectApplicationDashboards(
  input: ApplicationDashboardEvidence,
  settings: ClusterConfig,
  metricCluster: string,
  singleClusterConfirmed: boolean,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const evidence = structuredClone(input);
  if (
    evidence.pods.length > 1000 ||
    evidence.selectors.length < 1 ||
    evidence.selectors.length > 3 ||
    evidence.refs.length > 64
  )
    throw new Error('Application dashboard evidence exceeds its captured budgets');
  const capturedSettings = structuredClone(settings);
  const definitions = capturedSettings.customDashboards ?? {
    namespaceLabel: 'namespace',
    clusterLabel: 'cluster',
    dashboards: [],
  };
  const end = Math.floor(Date.now() / 1000);
  return withDiagnosticDeadline(
    signal,
    evidence.workload
      ? 'Workload dashboard inspection exceeded 15 seconds'
      : 'Application dashboard inspection exceeded 15 seconds',
    async requestSignal => {
      const annotation = await loadDashboardAnnotations(
        clusterScope(evidence.cluster),
        definitions,
        {
          namespace: evidence.namespace,
          ...(evidence.workload
            ? {
                workload: {
                  kind: evidence.workload.kind,
                  name: evidence.workload.name,
                },
              }
            : {}),
        },
        requestSignal
      );
      requestSignal.throwIfAborted();
      if (evidence.workload) {
        const source = annotation.sources[annotation.sources.length - 1];
        if (
          source.kind !== evidence.workload.kind ||
          source.name !== evidence.workload.name ||
          source.uid !== evidence.workload.uid ||
          source.resourceVersion !== evidence.workload.resourceVersion
        )
          throw new Error(
            'Workload changed since its ownership snapshot; refresh the workload before inspecting dashboards'
          );
      }
      const explicit = explicitApplicationDashboards(evidence, annotation.catalog);
      const scopeQuery: CustomDashboardScopeQuery = {
        namespace: evidence.namespace,
        namespaceLabel: definitions.namespaceLabel,
        clusterLabel: definitions.clusterLabel,
        metricCluster,
        singleClusterConfirmed,
        minutes: 15,
        end,
        annotationSources: annotation.sources,
      };
      const reads: {
        selector: ApplicationDashboardSelector;
        read:
          | {
              ok: true;
              query: DashboardDiscoveryQuery;
              runtimes: DashboardRuntime[];
              warnings: string[];
            }
          | { ok: false; error: ReadFailure };
      }[] = [];
      let refs: ApplicationDashboardRef[] = explicit.refs;
      let mode: 'explicit' | 'discovered' | 'deferred' = refs.length ? 'explicit' : 'deferred';
      let reason: ApplicationDashboardDeferral | undefined;
      const discoveryMode = definitions.discoveryMode ?? 'auto';
      const threshold = definitions.discoveryAutoThreshold ?? 10;
      if (!refs.length) {
        if (!evidence.complete) reason = 'incomplete';
        else if (discoveryMode === 'disabled') reason = 'disabled';
        else if (discoveryMode === 'auto' && evidence.pods.length > threshold) reason = 'threshold';
        else if (!annotation.catalog.templates.some(template => template.discoverOn))
          reason = 'no-definitions';
        else if (!capturedSettings.prometheus) reason = 'no-provider';
        else {
          mode = 'discovered';
          const winners = new Map<
            string,
            { runtime: DashboardRuntime; selector: ApplicationDashboardSelector }
          >();
          for (const selector of evidence.selectors) {
            requestSignal.throwIfAborted();
            const query: DashboardDiscoveryQuery = {
              ...scopeQuery,
              templates: annotation.catalog.templates,
              templateSources: [...annotation.catalog.origins].map(([name, origin]) => ({
                name,
                origin,
              })),
              labelsFilters: selector.filters,
            };
            try {
              try {
                dashboardDiscoveryRequest(query);
              } catch (error) {
                throw new InvalidResponseError(
                  error instanceof Error ? error.message : 'Invalid application metric scope'
                );
              }
              const result = await discoverCustomDashboards(
                clusterScope(evidence.cluster),
                capturedSettings.prometheus,
                query,
                requestSignal
              );
              reads.push({
                selector,
                read: {
                  ok: true,
                  query: result.query,
                  runtimes: result.runtimes,
                  warnings: result.warnings,
                },
              });
              // Pinned GetCustomDashboardRefs replaces a whole runtime group on later selector matches.
              for (const runtime of result.runtimes)
                winners.set(runtime.name, { runtime, selector });
            } catch (error) {
              if (requestSignal.aborted) throw error;
              reads.push({ selector, read: { ok: false, error: readFailure(error) } });
            }
          }
          refs = [...winners.values()]
            .sort((a, b) => compareGoStrings(a.runtime.name, b.runtime.name))
            .flatMap(({ runtime, selector }) =>
              runtime.dashboards.map(template => ({
                name: template.name,
                title: template.title,
                runtime: runtime.name,
                selector,
              }))
            );
        }
      }
      return {
        evidence,
        settings: capturedSettings,
        catalog: annotation.catalog,
        annotationSources: annotation.sources,
        scopeQuery,
        refs,
        unknown: explicit.unknown,
        reads,
        mode,
        reason,
        discoveryMode,
        threshold,
        partial: !evidence.complete || reads.some(read => read.read.ok === false),
      };
    }
  );
}
