import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';
import { useKialiConfig } from '../config';
import {
  ApplicationDashboardEvidence,
  ApplicationDashboardRef,
  captureApplicationDashboardEvidence,
} from '../core/applicationDashboards';
import { getClusterConfig } from '../core/config';
import { Application } from '../core/correlation';
import {
  customDashboardJobs,
  CustomDashboardQuery,
  resolveCustomDashboard,
} from '../core/customDashboards';
import { dashboardAggregationOptions } from '../core/dashboardAggregations';
import { HISTOGRAM_SUMMARIES, HistogramSummary } from '../core/histograms';
import { AppLabels } from '../core/labels';
import { inspectApplicationDashboards } from '../data/applicationDashboards';
import { useRequest } from '../hooks/useRequest';
import { useTelemetryQuery } from '../hooks/useTelemetryQuery';
import { DashboardResults } from './CustomDashboards';
import RequestStatus from './RequestStatus';

type Inspection = Awaited<ReturnType<typeof inspectApplicationDashboards>>;
interface InspectionQuery {
  evidence: ApplicationDashboardEvidence;
  metricCluster: string;
  confirmed: boolean;
}

function ApplicationTemplate({
  data,
  reference,
}: {
  data: Inspection;
  reference: ApplicationDashboardRef;
}) {
  const { t } = useTranslation();
  const [scopeIndex, setScopeIndex] = useState(
    reference.selector ? 'matched' : data.evidence.selectors.length === 1 ? '0' : ''
  );
  const [summaries, setSummaries] = useState<HistogramSummary[]>(['avg', 'p95']);
  const [selected, setSelected] = useState<string[]>();
  const [byLabels, setByLabels] = useState<string[]>([]);
  const [query, setQuery] = useState<CustomDashboardQuery>();
  const [error, setError] = useState('');
  let resolved: ReturnType<typeof resolveCustomDashboard> | undefined;
  let resolutionError: string | undefined;
  let aggregations: ReturnType<typeof dashboardAggregationOptions> = [];
  try {
    const result = resolveCustomDashboard(data.catalog.templates, reference.name);
    aggregations = dashboardAggregationOptions(result.dashboard);
    resolved = result;
  } catch (error) {
    resolutionError =
      error instanceof Error ? error.message : t('Application dashboard is unavailable');
  }
  const dashboard = resolved?.dashboard;
  const names = selected ?? dashboard?.items.map(item => item.chart.name) ?? [];
  const selector =
    reference.selector ??
    (scopeIndex === '' ? undefined : data.evidence.selectors[Number(scopeIndex)]);
  return (
    <SectionBox
      title={t('Application dashboard: {{name}}', { name: reference.title || reference.name })}
    >
      <Stack spacing={2}>
        <Alert severity="info">
          {t(
            'This view retains the inspected application namespace, metric-cluster selector, template sources and end instant. Different label conventions are not merged or summed. Reinspect the application to refresh the capture.'
          )}
        </Alert>
        {resolutionError ? (
          <Alert severity="error">{resolutionError}</Alert>
        ) : (
          <>
            {reference.selector ? (
              <Typography>
                {t('Matched metric label: {{metric}}; Kubernetes label convention: {{label}}', {
                  metric: reference.selector.metricLabel,
                  label: reference.selector.label,
                })}
              </Typography>
            ) : (
              <TextField
                select
                label={t('Application metric label convention')}
                value={scopeIndex}
                onChange={event => setScopeIndex(event.target.value)}
              >
                <MenuItem value="">{t('Choose an explicit metric label convention')}</MenuItem>
                {data.evidence.selectors.map((selector, index) => (
                  <MenuItem key={selector.label} value={String(index)}>
                    {selector.label} → {selector.metricLabel}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <Typography variant="body2">
              {t(
                'Pod dashboard annotations choose templates, not telemetry identity. Metric label names use the pinned punctuation-to-underscore mapping; verify that your metrics use the selected convention.'
              )}
            </Typography>
            <details open={(dashboard?.items.length ?? 0) > 8}>
              <summary>{t('Choose application dashboard charts')}</summary>
              <Button onClick={() => setSelected([])}>
                {t('Clear application chart selection')}
              </Button>
              {dashboard?.items.map(({ chart }) => (
                <FormControlLabel
                  key={chart.name}
                  label={t('Include application chart {{name}}', { name: chart.name })}
                  control={
                    <Checkbox
                      checked={names.includes(chart.name)}
                      onChange={event => {
                        const checked = event.target.checked;
                        setSelected(current => {
                          const previous = current ?? dashboard.items.map(item => item.chart.name);
                          return checked
                            ? [...previous, chart.name]
                            : previous.filter(name => name !== chart.name);
                        });
                      }}
                    />
                  }
                />
              ))}
            </details>
            {!!aggregations.length && (
              <Stack direction="row" useFlexGap flexWrap="wrap">
                {aggregations.map(option => (
                  <FormControlLabel
                    key={option.label}
                    label={t('Group application metrics by {{name}}', { name: option.displayName })}
                    control={
                      <Checkbox
                        checked={byLabels.includes(option.label)}
                        onChange={event =>
                          setByLabels(current =>
                            event.target.checked
                              ? [...current, option.label]
                              : current.filter(label => label !== option.label)
                          )
                        }
                      />
                    }
                  />
                ))}
              </Stack>
            )}
            {dashboard?.items.some(item => item.chart.dataType === 'histogram') && (
              <Stack direction="row" useFlexGap flexWrap="wrap">
                {HISTOGRAM_SUMMARIES.map(summary => (
                  <FormControlLabel
                    key={summary}
                    label={t('Application histogram {{name}}', {
                      name: summary === 'avg' ? t('Average') : summary.toUpperCase(),
                    })}
                    control={
                      <Checkbox
                        checked={summaries.includes(summary)}
                        onChange={event =>
                          setSummaries(current =>
                            event.target.checked
                              ? [...current, summary]
                              : current.filter(value => value !== summary)
                          )
                        }
                      />
                    }
                  />
                ))}
              </Stack>
            )}
            {!data.settings.prometheus && (
              <Alert severity="info">
                {t('Configure an existing Prometheus Service before loading application charts.')}
              </Alert>
            )}
            <Button
              variant="contained"
              disabled={!data.settings.prometheus}
              onClick={() => {
                try {
                  if (!resolved || !dashboard || !selector)
                    throw new Error(t('Choose an explicit application metric label convention'));
                  const next: CustomDashboardQuery = {
                    ...structuredClone(data.scopeQuery),
                    dashboard: structuredClone(dashboard),
                    chartNames: dashboard.items
                      .filter(item => names.includes(item.chart.name))
                      .map(item => item.chart.name),
                    byLabels: aggregations
                      .filter(option => byLabels.includes(option.label))
                      .map(option => option.label),
                    histogramSummaries: [...summaries],
                    labelsFilters: { ...selector.filters },
                    templateReferences: resolved.references.map(item => {
                      const origin = data.catalog.origins.get(item.name);
                      if (!origin) throw new Error(t('Dashboard definition source is unavailable'));
                      return { ...item, origin };
                    }),
                  };
                  customDashboardJobs(next);
                  setError('');
                  setQuery(next);
                } catch (error) {
                  setQuery(undefined);
                  setError(
                    error instanceof Error
                      ? error.message
                      : t('Invalid application dashboard query')
                  );
                }
              }}
            >
              {t('Load captured application dashboard')}
            </Button>
          </>
        )}
        {error && <Alert severity="error">{error}</Alert>}
        {query && data.settings.prometheus && (
          <DashboardResults
            cluster={data.evidence.cluster}
            endpoint={data.settings.prometheus}
            query={query}
          />
        )}
      </Stack>
    </SectionBox>
  );
}

function InspectionResults({
  query,
  settings,
}: {
  query: InspectionQuery;
  settings: ReturnType<typeof getClusterConfig>;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<{
    data: Inspection;
    reference: ApplicationDashboardRef;
  }>();
  const load = useCallback(
    (signal: AbortSignal) =>
      inspectApplicationDashboards(
        query.evidence,
        settings,
        query.metricCluster,
        query.confirmed,
        signal
      ),
    [query, settings]
  );
  const state = useRequest(JSON.stringify([query, settings]), load);
  return (
    <RequestStatus state={state} loadingLabel={t('Inspecting application dashboards...')}>
      {data => (
        <Stack spacing={2}>
          <Typography>
            {t(
              'Captured application: {{application}}; namespace: {{namespace}}; owned Pods: {{count}}',
              {
                application: data.evidence.application,
                namespace: data.evidence.namespace,
                count: data.evidence.pods.length,
              }
            )}
          </Typography>
          <Alert severity="info">
            {t(
              'Template references and matching metric names do not prove an application runtime, ownership of telemetry or health. Pod references take precedence when any resolve; unresolved names are reported. Metric selectors are evaluated in pinned order, with later matches replacing the same runtime group.'
            )}
          </Alert>
          {data.partial && (
            <Alert severity="warning">
              {t(
                'Application evidence or selector reads are incomplete. These are observed candidates, not a complete runtime inventory.'
              )}
            </Alert>
          )}
          {!!data.unknown.length && (
            <Alert severity="warning">
              {t('Unknown or disabled Pod dashboard references: {{names}}', {
                names: data.unknown.join(', '),
              })}
            </Alert>
          )}
          {data.reason && (
            <Alert severity="info">
              {
                {
                  incomplete: t(
                    'Application relationship evidence is incomplete; absence of explicit dashboard references cannot be established'
                  ),
                  disabled: t('Application metric discovery is disabled'),
                  threshold: t(
                    'Application has {{count}} observed Pods, exceeding the configured auto-discovery threshold {{threshold}}',
                    { count: data.evidence.pods.length, threshold: data.threshold }
                  ),
                  'no-definitions': t(
                    'No effective dashboard definitions declare discovery metrics'
                  ),
                  'no-provider': t(
                    'Configure an existing Prometheus Service before application metric discovery'
                  ),
                }[data.reason]
              }
            </Alert>
          )}
          <details>
            <summary>{t('Show captured Namespace dashboard source')}</summary>
            <SimpleTable
              data={data.annotationSources}
              columns={[
                { label: t('Resource'), getter: source => `${source.kind}/${source.name}` },
                { label: t('UID'), getter: source => source.uid },
                { label: t('Resource version'), getter: source => source.resourceVersion },
                {
                  label: t('Dashboard annotation'),
                  getter: source =>
                    source.annotationPresent
                      ? t('Declared templates: {{count}}', { count: source.definitions.length })
                      : t('Not present'),
                },
              ]}
            />
          </details>
          {data.refs.length ? (
            <SimpleTable
              data={data.refs}
              columns={[
                { label: t('Template'), getter: item => item.name },
                { label: t('Title'), getter: item => item.title || t('Title not specified') },
                {
                  label: t('Declared runtime'),
                  getter: item => item.runtime || t('Unspecified runtime'),
                },
                {
                  label: t('Evidence'),
                  getter: item =>
                    item.selector ? item.selector.metricLabel : t('Captured Pod annotation'),
                },
                {
                  label: t('Action'),
                  getter: item => (
                    <Button onClick={() => setSelected({ data, reference: item })}>
                      {t('Inspect {{name}} charts', { name: item.name })}
                    </Button>
                  ),
                },
              ]}
            />
          ) : (
            !data.reason && (
              <Alert severity={data.partial ? 'warning' : 'info'}>
                {t(
                  'No dashboard candidates were established from these captured reads. This is not a health verdict.'
                )}
              </Alert>
            )
          )}
          {!!data.reads.length && (
            <details>
              <summary>{t('Show application selector outcomes')}</summary>
              {data.reads.map(item => (
                <Stack key={item.selector.label} spacing={0.5}>
                  <Typography>
                    {item.selector.label} → {item.selector.metricLabel}:{' '}
                    {item.read.ok === false
                      ? item.read.error.message
                      : t('Matched runtime groups: {{count}}', {
                          count: item.read.runtimes.length,
                        })}
                  </Typography>
                  {item.read.ok && !!item.read.warnings.length && (
                    <Alert severity="warning">{item.read.warnings.join('; ')}</Alert>
                  )}
                </Stack>
              ))}
            </details>
          )}
          <details>
            <summary>{t('Show captured Pod dashboard references')}</summary>
            <SimpleTable
              data={data.evidence.pods}
              columns={[
                { label: t('Pod'), getter: pod => pod.name },
                { label: t('UID'), getter: pod => pod.uid },
                { label: t('Resource version'), getter: pod => pod.resourceVersion },
                {
                  label: t('Template references'),
                  getter: pod => pod.refs.join(', ') || t('None declared'),
                },
              ]}
            />
          </details>
          {selected?.data === data && (
            <ApplicationTemplate
              key={JSON.stringify([data.evidence, data.scopeQuery, selected.reference])}
              data={data}
              reference={selected.reference}
            />
          )}
        </Stack>
      )}
    </RequestStatus>
  );
}

export default function ApplicationDashboards({
  app,
  complete,
  labels,
}: {
  app: Application;
  complete: boolean;
  labels: AppLabels | null;
}) {
  const { t } = useTranslation();
  const config = useKialiConfig();
  const settings = config.valid ? getClusterConfig(config.config, app.cluster) : undefined;
  let evidence: ApplicationDashboardEvidence | undefined;
  let evidenceError: string | undefined;
  try {
    evidence = captureApplicationDashboardEvidence(app, complete, labels);
  } catch (error) {
    evidenceError =
      error instanceof Error ? error.message : t('Application dashboard evidence is unavailable');
  }
  const binding = JSON.stringify([
    evidence,
    evidenceError,
    settings,
    app.workloads.map(workload => [
      workload.identity,
      workload.resource.resourceVersion,
      workload.app,
    ]),
  ]);
  const { identity, setIdentity, query, setQuery, capturedSettings } =
    useTelemetryQuery<InspectionQuery>(binding, settings);
  const [acknowledged, setAcknowledged] = useState<string>();
  useEffect(() => setAcknowledged(undefined), [binding]);
  return (
    <SectionBox title={t('Application dashboards')}>
      <Stack spacing={2}>
        <Typography>
          {t(
            'Inspect dashboard references from captured UID-attributed Pods, then conditionally discover metric names. Namespace annotation overrides are read explicitly. Auto mode uses the pinned default threshold of ten observed Pods; configured settings can change that policy. No runtime is inferred from replicas or metric values.'
          )}
        </Typography>
        <Link routeName="kiali-settings" params={{ cluster: app.cluster }}>
          {t('Configure application dashboard discovery')}
        </Link>
        {config.valid === false ? (
          <Alert severity="error">{config.message}</Alert>
        ) : evidenceError ? (
          <Alert severity="warning">{evidenceError}</Alert>
        ) : (
          <>
            <TextField
              label={t('Application dashboard metric cluster')}
              value={identity}
              onChange={event => setIdentity(event.target.value)}
            />
            {settings?.customDashboards?.clusterLabel === null && (
              <FormControlLabel
                label={t(
                  'I confirm the application dashboard metrics source contains only one cluster'
                )}
                control={
                  <Checkbox
                    checked={acknowledged === binding}
                    onChange={event => setAcknowledged(event.target.checked ? binding : undefined)}
                  />
                }
              />
            )}
            <Button
              variant="outlined"
              onClick={() => {
                if (evidence)
                  setQuery({
                    evidence: structuredClone(evidence),
                    metricCluster: identity,
                    confirmed: acknowledged === binding,
                  });
              }}
            >
              {t('Inspect application dashboard recommendations')}
            </Button>
          </>
        )}
        {query && capturedSettings && (
          <InspectionResults query={query} settings={capturedSettings} />
        )}
      </Stack>
    </SectionBox>
  );
}
