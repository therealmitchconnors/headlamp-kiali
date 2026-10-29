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
import { useLocation } from 'react-router-dom';
import { useKialiConfig } from '../config';
import { getClusterConfig, ServiceEndpoint } from '../core/config';
import {
  customDashboardJobs,
  CustomDashboardQuery,
  CustomDashboardScopeQuery,
  dashboardLabelFilters,
  resolveCustomDashboard,
} from '../core/customDashboards';
import { DashboardDiscoveryQuery, dashboardDiscoveryRequest } from '../core/dashboardDiscovery';
import { HISTOGRAM_SUMMARIES, HistogramSummary } from '../core/histograms';
import { ComparisonMetric, groupedMetricComparisons } from '../core/metricComparison';
import { clusterScope } from '../core/scope';
import { loadCustomDashboard } from '../data/customDashboards';
import { useRequest } from '../hooks/useRequest';
import { useTelemetryQuery } from '../hooks/useTelemetryQuery';
import ClusterScope from './ClusterScope';
import DashboardDiscovery from './DashboardDiscovery';
import MetricChart from './MetricChart';
import MetricComparisonChart from './MetricComparisonChart';
import RequestStatus from './RequestStatus';

type DashboardRead = Awaited<ReturnType<typeof loadCustomDashboard>>['charts'][number];
function groupedCharts(charts: readonly DashboardRead[]) {
  const groups = new Map<string, DashboardRead[]>();
  for (const chart of charts) {
    const key = JSON.stringify([chart.chartIndex, chart.summary ?? 'value']);
    const group = groups.get(key) ?? [];
    group.push(chart);
    groups.set(key, group);
  }
  return [...groups];
}

function DashboardResults({
  cluster,
  endpoint,
  query,
}: {
  cluster: string;
  endpoint: ServiceEndpoint;
  query: CustomDashboardQuery;
}) {
  const { t } = useTranslation();
  const summaryNames = { avg: t('Average'), p50: 'P50', p90: 'P90', p95: 'P95', p99: 'P99' };
  const load = useCallback(
    (signal: AbortSignal) => loadCustomDashboard(clusterScope(cluster), endpoint, query, signal),
    [cluster, endpoint, query]
  );
  const state = useRequest(JSON.stringify([cluster, endpoint, query]), load);
  return (
    <RequestStatus state={state} loadingLabel={t('Loading custom dashboard...')}>
      {data => (
        <Stack spacing={2}>
          <Typography>
            {t('Captured dashboard: {{title}}; namespace {{namespace}}; ending {{time}}', {
              title: data.query.dashboard.title,
              namespace: data.query.namespace,
              time: new Date(data.query.end * 1000).toISOString(),
            })}
          </Typography>
          <Alert severity="info">
            {data.query.clusterLabel
              ? t('Captured metric cluster filter: {{label}} = {{value}}', {
                  label: data.query.clusterLabel,
                  value: data.query.metricCluster,
                })
              : t(
                  'No dedicated metric-cluster selector was configured. You explicitly confirmed this source contains only one cluster; the plugin cannot verify that assertion.'
                )}
          </Alert>
          {!!data.query.templateReferences?.length && (
            <details>
              <summary>{t('Show captured dashboard template references')}</summary>
              <SimpleTable
                data={data.query.templateReferences}
                columns={[
                  { label: t('Template'), getter: item => item.name },
                  { label: t('Title'), getter: item => item.title },
                ]}
              />
            </details>
          )}
          {!!Object.keys(data.query.labelsFilters ?? {}).length && (
            <details>
              <summary>{t('Show captured dashboard label filters')}</summary>
              <SimpleTable
                data={Object.entries(data.query.labelsFilters ?? {})}
                columns={[
                  { label: t('Metric label'), getter: ([key]: [string, string]) => key },
                  {
                    label: t('Literal value'),
                    getter: ([, value]: [string, string]) =>
                      value === '' ? t('Empty; also matches an omitted label') : value,
                  },
                ]}
              />
            </details>
          )}
          {groupedCharts(data.charts).map(([key, entries]) => {
            const { chart, summary } = entries[0];
            const grouped = !!chart.groupLabels?.length;
            const title = summary
              ? t('{{chart}} - {{summary}}', { chart: chart.name, summary: summaryNames[summary] })
              : chart.name;
            let successful: ComparisonMetric[] = entries.flatMap((entry, index) =>
              entry.read.ok
                ? [{ name: entry.metric.displayName, result: entry.read.result, colorIndex: index }]
                : []
            );
            let groupingError: string | undefined;
            if (grouped) {
              try {
                successful = groupedMetricComparisons(successful, chart.groupLabels ?? []).map(
                  (metric, index) => ({ ...metric, colorIndex: index })
                );
              } catch (error) {
                successful = [];
                groupingError =
                  error instanceof Error ? error.message : t('Grouped chart is unavailable');
              }
            }
            return (
              <SectionBox key={key} title={title}>
                {grouped && (
                  <Typography variant="body2">
                    {t(
                      'Captured grouping labels: {{labels}}. Groups are metric dimensions, not Kubernetes resource identities.',
                      { labels: chart.groupLabels?.join(', ') }
                    )}
                  </Typography>
                )}
                {groupingError && <Alert severity="error">{groupingError}</Alert>}
                {entries.map(({ key, metric, read }) => (
                  <Stack key={key} spacing={1}>
                    {(entries.length > 1 || metric.displayName !== chart.name) && (
                      <Typography variant="subtitle2">{metric.displayName}</Typography>
                    )}
                    <Typography variant="body2">
                      {t(
                        'Metric: {{metric}}; data type: {{type}}; aggregation: {{aggregation}}; unit scale: {{scale}}',
                        {
                          metric: metric.metricName,
                          type: chart.dataType,
                          aggregation: chart.aggregator ?? 'sum',
                          scale: chart.unitScale ?? 1,
                        }
                      )}
                    </Typography>
                    {read.ok === false ? (
                      <Alert severity="error">
                        {entries.length > 1
                          ? `${metric.displayName}: ${read.error.message}`
                          : read.error.message}
                      </Alert>
                    ) : (
                      <>
                        {!!read.result.warnings.length && (
                          <Alert severity="warning">{read.result.warnings.join('; ')}</Alert>
                        )}
                        {(entries.length > 1 || grouped) &&
                          !read.result.series.some(series =>
                            series.samples.some(sample => sample.value !== null)
                          ) && (
                            <Alert severity="info">
                              {t('No finite samples were returned for {{metric}}.', {
                                metric: metric.displayName,
                              })}
                            </Alert>
                          )}
                      </>
                    )}
                  </Stack>
                ))}
                {successful.length > 0 &&
                  (entries.length === 1 && !grouped ? (
                    <MetricChart
                      result={successful[0].result}
                      title={title}
                      unit={chart.unit ?? null}
                      seriesName={entries[0].metric.displayName}
                    />
                  ) : (
                    <MetricComparisonChart
                      metrics={successful}
                      title={title}
                      unit={chart.unit ?? null}
                    />
                  ))}
              </SectionBox>
            );
          })}
          <details>
            <summary>{t('Show captured dashboard queries')}</summary>
            {customDashboardJobs(data.query).map(job => (
              <Typography
                key={job.key}
                component="pre"
                sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
              >
                {job.expression}
              </Typography>
            ))}
          </details>
        </Stack>
      )}
    </RequestStatus>
  );
}

export function CustomDashboardScope({ cluster }: { cluster: string }) {
  const { t } = useTranslation();
  const config = useKialiConfig();
  const settings = config.valid ? getClusterConfig(config.config, cluster) : undefined;
  const definition = settings?.customDashboards;
  const [selected, setSelected] = useState('');
  const [namespace, setNamespace] = useState(
    new URLSearchParams(useLocation().search).get('namespace') ?? ''
  );
  const [minutes, setMinutes] = useState<CustomDashboardQuery['minutes']>(15);
  const [summaries, setSummaries] = useState<HistogramSummary[]>(['avg', 'p95']);
  const [filterText, setFilterText] = useState('{}');
  const [current, setCurrent] = useState(true);
  const [endTime, setEndTime] = useState('');
  const [acknowledged, setAcknowledged] = useState<string>();
  const [error, setError] = useState('');
  const binding = JSON.stringify([
    cluster,
    settings?.prometheus,
    settings?.telemetryCluster,
    definition,
  ]);
  useEffect(() => setError(''), [binding]);
  const { identity, setIdentity, query, setQuery, capturedSettings } =
    useTelemetryQuery<CustomDashboardQuery>(binding, settings);
  const discovery = useTelemetryQuery<DashboardDiscoveryQuery>(binding, settings);
  const template =
    definition?.dashboards.find(item => item.name === selected) ?? definition?.dashboards[0];
  let resolved: ReturnType<typeof resolveCustomDashboard> | undefined;
  let resolutionError: string | undefined;
  if (template && definition) {
    try {
      resolved = resolveCustomDashboard(definition.dashboards, template.name);
    } catch (error) {
      resolutionError =
        error instanceof Error ? error.message : t('Dashboard composition is unavailable');
    }
  }
  const dashboard = resolved?.dashboard;
  const hasHistograms = dashboard?.items.some(item => item.chart.dataType === 'histogram');
  const captureScope = (): CustomDashboardScopeQuery => {
    if (!definition) throw new Error(t('Configure dashboard definitions before querying'));
    return {
      namespace,
      metricCluster: identity,
      minutes,
      end: current ? Math.floor(Date.now() / 1000) : Math.floor(new Date(endTime).getTime() / 1000),
      namespaceLabel: definition.namespaceLabel,
      clusterLabel: definition.clusterLabel,
      singleClusterConfirmed: acknowledged === binding,
      labelsFilters: dashboardLabelFilters(
        JSON.parse(filterText),
        definition.namespaceLabel,
        definition.clusterLabel
      ),
    };
  };
  return (
    <Stack spacing={2}>
      <SectionBox title={t('Custom aggregate dashboards')} headerProps={{ headerStyle: 'main' }}>
        <Stack spacing={2}>
          <Alert severity="info">
            {t(
              'This native dashboard view supports saved template includes, named metrics on raw/rate charts and classic histogram summaries, with optional groupLabels. Raw gauges and custom histogram observations may be negative; rates use sum(rate(...[5m])). Histogram averages use sum/count counters and quantiles use cumulative buckets, never averages of precomputed percentiles. Metrics aggregate within their selected groups; different metrics and groups are compared, not added together. Duplicate scrapes are not reconciled. Reads use 15-second samples, at most eight expanded metric queries, three concurrent requests and a 15-second deadline. Grouped responses and chart panels are limited to eight series; overflow is an error, not truncation. Missing samples are not zero or healthy. Native histograms, built-in discovery, annotation overrides and external dashboard links remain unsupported.'
            )}
          </Alert>
          <Link routeName="kiali-settings" params={{ cluster }}>
            {t('Configure dashboard definitions')}
          </Link>
          {config.valid === false ? (
            <Alert severity="error">{config.message}</Alert>
          ) : !definition?.dashboards.length ? (
            <Alert severity="info">
              {t('No custom aggregate dashboards are configured for this cluster.')}
            </Alert>
          ) : !settings?.prometheus ? (
            <Alert severity="info">
              {t('Configure an existing Prometheus Service before loading dashboards.')}
            </Alert>
          ) : (
            <>
              <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap">
                <TextField
                  select
                  label={t('Dashboard template')}
                  sx={{ minWidth: 200 }}
                  value={template?.name ?? ''}
                  onChange={event => {
                    setSelected(event.target.value);
                    setError('');
                  }}
                >
                  {definition.dashboards.map(item => (
                    <MenuItem key={item.name} value={item.name}>
                      {item.title}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  label={t('Dashboard namespace')}
                  sx={{ minWidth: 220 }}
                  value={namespace}
                  onChange={event => setNamespace(event.target.value)}
                  helperText={t('Metric namespace label: {{label}}', {
                    label: definition.namespaceLabel,
                  })}
                />
                {definition.clusterLabel && (
                  <TextField
                    label={t('Dashboard metric cluster value')}
                    sx={{ minWidth: 280 }}
                    value={identity}
                    onChange={event => setIdentity(event.target.value)}
                    helperText={t(
                      'Metric cluster label: {{label}}. This is not assumed to be the Headlamp context name.',
                      { label: definition.clusterLabel }
                    )}
                  />
                )}
                <TextField
                  select
                  label={t('Dashboard time range')}
                  sx={{ minWidth: 180 }}
                  value={minutes}
                  onChange={event => {
                    const value = Number(event.target.value);
                    if (value === 5 || value === 15 || value === 60) setMinutes(value);
                  }}
                >
                  {[5, 15, 60].map(value => (
                    <MenuItem key={value} value={value}>
                      {t('{{count}} minutes', { count: value })}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
              <TextField
                label={t('Additional metric labels (JSON)')}
                multiline
                minRows={2}
                maxRows={6}
                value={filterText}
                onChange={event => setFilterText(event.target.value)}
                inputProps={{ maxLength: 16384 }}
                helperText={t(
                  'Optional exact equality filters, for example {"job":"my-runtime"}. Up to 10 labels; namespace and configured metric-cluster labels cannot be replaced. Empty values also match missing labels. These drafts are captured only when loading and are not saved to settings or navigation URLs.'
                )}
              />
              {hasHistograms && (
                <Stack spacing={1}>
                  <Typography>
                    {t(
                      'Histogram summaries use five-minute rate windows. Average and P95 are the initial view selection; each selected summary counts toward the eight-query dashboard limit.'
                    )}
                  </Typography>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    {HISTOGRAM_SUMMARIES.map(summary => (
                      <FormControlLabel
                        key={summary}
                        label={t('Histogram summary {{name}}', {
                          name: summary === 'avg' ? t('Average') : summary.toUpperCase(),
                        })}
                        control={
                          <Checkbox
                            checked={summaries.includes(summary)}
                            onChange={event => {
                              setSummaries(current =>
                                event.target.checked
                                  ? [...current, summary]
                                  : current.filter(value => value !== summary)
                              );
                            }}
                          />
                        }
                      />
                    ))}
                  </Stack>
                </Stack>
              )}
              {definition.clusterLabel === null && (
                <FormControlLabel
                  label={t('I confirm this Prometheus source contains only one cluster')}
                  control={
                    <Checkbox
                      checked={acknowledged === binding}
                      onChange={event =>
                        setAcknowledged(event.target.checked ? binding : undefined)
                      }
                    />
                  }
                />
              )}
              <FormControlLabel
                label={t('Use current dashboard time')}
                control={
                  <Checkbox
                    checked={current}
                    onChange={event => setCurrent(event.target.checked)}
                  />
                }
              />
              {!current && (
                <TextField
                  label={t('Dashboard end time (local time)')}
                  type="datetime-local"
                  value={endTime}
                  InputLabelProps={{ shrink: true }}
                  onChange={event => setEndTime(event.target.value)}
                />
              )}
              <Button
                variant="contained"
                onClick={() => {
                  try {
                    if (!dashboard || !resolved)
                      throw new Error(resolutionError ?? t('Choose a configured dashboard'));
                    const next: CustomDashboardQuery = {
                      ...captureScope(),
                      dashboard: structuredClone(dashboard),
                      templateReferences: structuredClone(resolved.references),
                      ...(hasHistograms ? { histogramSummaries: [...summaries] } : {}),
                    };
                    customDashboardJobs(next);
                    setError('');
                    setQuery(next);
                  } catch (error) {
                    setQuery(undefined);
                    setError(
                      error instanceof Error ? error.message : t('Invalid dashboard selection')
                    );
                  }
                }}
              >
                {t('Load custom dashboard')}
              </Button>
              {definition.dashboards.some(template => template.discoverOn) && (
                <>
                  <Typography variant="body2">
                    {t(
                      'Saved-template discovery checks exact discoverOn metric names at the captured end instant. The time-range length and histogram-summary selections do not affect discovery. It does not import a built-in catalog or automatically inspect applications.'
                    )}
                  </Typography>
                  <Button
                    variant="outlined"
                    onClick={() => {
                      try {
                        const next: DashboardDiscoveryQuery = {
                          ...captureScope(),
                          templates: structuredClone(definition.dashboards),
                        };
                        dashboardDiscoveryRequest(next);
                        setError('');
                        discovery.setQuery(next);
                      } catch (error) {
                        discovery.setQuery(undefined);
                        setError(
                          error instanceof Error
                            ? error.message
                            : t('Invalid dashboard discovery selection')
                        );
                      }
                    }}
                  >
                    {t('Discover saved dashboards')}
                  </Button>
                </>
              )}
            </>
          )}
          {(error || resolutionError) && <Alert severity="error">{error || resolutionError}</Alert>}
        </Stack>
      </SectionBox>
      {query && capturedSettings?.prometheus && (
        <DashboardResults cluster={cluster} endpoint={capturedSettings.prometheus} query={query} />
      )}
      {discovery.query && discovery.capturedSettings?.prometheus && (
        <DashboardDiscovery
          cluster={cluster}
          endpoint={discovery.capturedSettings.prometheus}
          query={discovery.query}
          onSelect={name => {
            setSelected(name);
            setError('');
          }}
        />
      )}
    </Stack>
  );
}
export default function CustomDashboards() {
  return (
    <ClusterScope>
      {scope => <CustomDashboardScope key={scope.cluster} cluster={scope.cluster} />}
    </ClusterScope>
  );
}
