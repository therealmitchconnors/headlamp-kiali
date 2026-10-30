import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
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
  CustomChart,
  customChartMetrics,
  customDashboardJobs,
  CustomDashboardQuery,
  CustomDashboardScopeQuery,
  CustomDashboardSettings,
  dashboardLabelFilters,
  resolveCustomDashboard,
} from '../core/customDashboards';
import { DashboardAggregation, dashboardAggregationOptions } from '../core/dashboardAggregations';
import { BUILTIN_DASHBOARD_SOURCE, effectiveDashboardCatalog } from '../core/dashboardCatalog';
import { DashboardDiscoveryQuery, dashboardDiscoveryRequest } from '../core/dashboardDiscovery';
import { HISTOGRAM_SUMMARIES, HistogramSummary } from '../core/histograms';
import { ComparisonMetric, groupedMetricComparisons } from '../core/metricComparison';
import { clusterScope } from '../core/scope';
import { loadCustomDashboard } from '../data/customDashboards';
import { useRequest } from '../hooks/useRequest';
import { useTelemetryQuery } from '../hooks/useTelemetryQuery';
import ClusterScope from './ClusterScope';
import DashboardAnnotations, { DashboardAnnotationState } from './DashboardAnnotations';
import DashboardDiscovery from './DashboardDiscovery';
import DashboardValueFilters from './DashboardValueFilters';
import MetricCategoryChart from './MetricCategoryChart';
import MetricChart from './MetricChart';
import MetricComparisonChart from './MetricComparisonChart';
import RequestStatus from './RequestStatus';

type DashboardRead = Awaited<ReturnType<typeof loadCustomDashboard>>['charts'][number];
function groupedCharts<T extends DashboardRead>(charts: readonly T[]) {
  const groups = new Map<string, T[]>();
  for (const chart of charts) {
    const key = JSON.stringify([chart.chartIndex, chart.summary ?? 'value']);
    const group = groups.get(key) ?? [];
    group.push(chart);
    groups.set(key, group);
  }
  return [...groups];
}

export function DashboardResults({
  cluster,
  endpoint,
  query,
}: {
  cluster: string;
  endpoint: ServiceEndpoint;
  query: CustomDashboardQuery;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<{
    data: Awaited<ReturnType<typeof loadCustomDashboard>>;
    key: string;
  }>();
  useEffect(() => setExpanded(undefined), [cluster, endpoint, query]);
  const summaryNames = { avg: t('Average'), p50: 'P50', p90: 'P90', p95: 'P95', p99: 'P99' };
  const load = useCallback(
    (signal: AbortSignal) => loadCustomDashboard(clusterScope(cluster), endpoint, query, signal),
    [cluster, endpoint, query]
  );
  const state = useRequest(JSON.stringify([cluster, endpoint, query]), load);
  return (
    <RequestStatus state={state} loadingLabel={t('Loading custom dashboard...')}>
      {data => (
        <DashboardValueFilters data={data}>
          {(charts, filters) => (
            <Stack spacing={2}>
              <Typography>
                {t('Captured dashboard: {{title}}; namespace {{namespace}}; ending {{time}}', {
                  title: data.query.dashboard.title,
                  namespace: data.query.namespace,
                  time: new Date(data.query.end * 1000).toISOString(),
                })}
              </Typography>
              <Typography variant="body2">
                {t(
                  'Captured chart selection: {{selected}} of {{total}} configured charts. Only the selected charts were queried.',
                  {
                    selected: data.query.chartNames?.length ?? data.query.dashboard.items.length,
                    total: data.query.dashboard.items.length,
                  }
                )}
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
              {!!data.query.byLabels?.length && (
                <Typography variant="body2">
                  {t('Captured optional grouping labels: {{labels}}', {
                    labels: data.query.byLabels.join(', '),
                  })}
                </Typography>
              )}
              {!!data.query.templateReferences?.length && (
                <details>
                  <summary>{t('Show captured dashboard template references')}</summary>
                  <SimpleTable
                    data={data.query.templateReferences}
                    columns={[
                      { label: t('Template'), getter: item => item.name },
                      { label: t('Title'), getter: item => item.title },
                      {
                        label: t('Definition source'),
                        getter: item =>
                          item.origin === 'builtin'
                            ? t('Bundled Kiali template')
                            : item.origin === 'custom'
                            ? t('Saved custom definition')
                            : item.origin === 'namespace'
                            ? t('Namespace annotation')
                            : item.origin === 'workload'
                            ? t('Workload annotation')
                            : t('Source not captured'),
                      },
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
              {filters}
              <Box
                sx={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 2 }}
              >
                {groupedCharts(charts).map(([key, entries]) => {
                  const { chart, summary, groupLabels } = entries[0];
                  const grouped = !!groupLabels.length;
                  const title = summary
                    ? t('{{chart}} - {{summary}}', {
                        chart: chart.name,
                        summary: summaryNames[summary],
                      })
                    : chart.name;
                  let successful: ComparisonMetric[] = entries.flatMap((entry, index) =>
                    entry.read.ok
                      ? [
                          {
                            name: entry.metric.displayName,
                            result: entry.read.result,
                            colorIndex: index,
                          },
                        ]
                      : []
                  );
                  let groupingError: string | undefined;
                  if (grouped) {
                    try {
                      successful = groupedMetricComparisons(
                        successful,
                        groupLabels,
                        !!chart.sortLabel
                      ).map((metric, index) => ({ ...metric, colorIndex: index }));
                    } catch (error) {
                      successful = [];
                      groupingError =
                        error instanceof Error ? error.message : t('Grouped chart is unavailable');
                    }
                  }
                  const panel = (height?: number) => (
                    <SectionBox title={title}>
                      {chart.chartType && (
                        <Typography variant="body2">
                          {t(
                            'Captured chart style: {{style}}. Values remain independent; there is no stacking.',
                            {
                              style: {
                                line: t('Line'),
                                area: t('Area'),
                                bar: t('Bar'),
                                scatter: t('Points'),
                              }[chart.chartType],
                            }
                          )}
                        </Typography>
                      )}
                      {chart.sortLabel && (
                        <Typography variant="body2">
                          {t(
                            'Captured series ordering: {{label}} ({{mode}}). Sort-only labels are omitted from displayed groups; series are never merged.',
                            {
                              label: chart.sortLabel,
                              mode:
                                chart.sortLabelParseAs === 'int'
                                  ? t('signed integer')
                                  : t('lexical'),
                            }
                          )}
                        </Typography>
                      )}
                      {grouped && (
                        <Typography variant="body2">
                          {t(
                            'Captured grouping labels: {{labels}}. Groups are metric dimensions, not Kubernetes resource identities.',
                            { labels: groupLabels.join(', ') }
                          )}
                        </Typography>
                      )}
                      {groupingError && <Alert severity="error">{groupingError}</Alert>}
                      {entries.map(({ key, metric, read, hiddenSeries }) => (
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
                                    {hiddenSeries > 0
                                      ? t(
                                          'No finite samples are visible for {{metric}} with the current display filters.',
                                          { metric: metric.displayName }
                                        )
                                      : t('No finite samples were returned for {{metric}}.', {
                                          metric: metric.displayName,
                                        })}
                                  </Alert>
                                )}
                            </>
                          )}
                        </Stack>
                      ))}
                      {successful.length > 0 &&
                        (chart.xAxis === 'series' ? (
                          <MetricCategoryChart
                            metrics={successful}
                            title={title}
                            unit={chart.unit ?? null}
                            chartType={chart.chartType}
                            min={chart.min}
                            max={chart.max}
                            height={height}
                          />
                        ) : entries.length === 1 && !grouped ? (
                          <MetricChart
                            result={successful[0].result}
                            title={title}
                            unit={chart.unit ?? null}
                            seriesName={entries[0].metric.displayName}
                            min={chart.min}
                            max={chart.max}
                            height={height}
                            chartType={chart.chartType}
                          />
                        ) : (
                          <MetricComparisonChart
                            metrics={successful}
                            title={title}
                            unit={chart.unit ?? null}
                            min={chart.min}
                            max={chart.max}
                            height={height}
                            chartType={chart.chartType}
                          />
                        ))}
                    </SectionBox>
                  );
                  const open = expanded?.data === data && expanded.key === key;
                  const titleId = `kiali-expanded-${data.query.dashboard.name}-${
                    entries[0].chartIndex
                  }-${summary ?? 'value'}`;
                  return (
                    <Box
                      key={key}
                      component="section"
                      aria-label={title}
                      sx={{
                        gridColumn: { xs: 'span 12', md: `span ${chart.spans ?? 12}` },
                        minWidth: 0,
                        minHeight: open ? 360 : undefined,
                        overflowWrap: 'anywhere',
                      }}
                    >
                      <Stack direction="row" justifyContent="flex-end">
                        <Button
                          size="small"
                          onClick={() => setExpanded({ data, key })}
                          aria-label={t('Expand {{chart}}', { chart: title })}
                        >
                          {t('Expand chart')}
                        </Button>
                      </Stack>
                      {open ? (
                        <Typography>{t('Chart is open in the expanded view.')}</Typography>
                      ) : (
                        panel()
                      )}
                      <Dialog
                        open={open}
                        onClose={() => setExpanded(undefined)}
                        fullWidth
                        maxWidth="xl"
                        aria-labelledby={titleId}
                      >
                        <DialogTitle id={titleId}>
                          {t('Expanded chart: {{chart}}', { chart: title })}
                        </DialogTitle>
                        <DialogContent dividers>
                          <Stack spacing={2}>
                            <Typography>
                              {t(
                                'Captured dashboard: {{title}}; namespace {{namespace}}; ending {{time}}',
                                {
                                  title: data.query.dashboard.title,
                                  namespace: data.query.namespace,
                                  time: new Date(data.query.end * 1000).toISOString(),
                                }
                              )}
                            </Typography>
                            <Typography>
                              {data.query.clusterLabel
                                ? t('Captured metric cluster filter: {{label}} = {{value}}', {
                                    label: data.query.clusterLabel,
                                    value: data.query.metricCluster,
                                  })
                                : t(
                                    'No dedicated metric-cluster filter; this capture uses the confirmed single-cluster source.'
                                  )}
                            </Typography>
                            {!!Object.keys(data.query.labelsFilters ?? {}).length && (
                              <SimpleTable
                                data={Object.entries(data.query.labelsFilters ?? {})}
                                columns={[
                                  { label: t('Metric label'), getter: ([key]) => key },
                                  {
                                    label: t('Literal value'),
                                    getter: ([, value]) =>
                                      value || t('Empty; also matches an omitted label'),
                                  },
                                ]}
                              />
                            )}
                            <Typography variant="body2">
                              {t(
                                'This expands the captured result without issuing requests. Close this view to change display filters or load new data.'
                              )}
                            </Typography>
                            {open && panel(520)}
                          </Stack>
                        </DialogContent>
                        <DialogActions>
                          <Button onClick={() => setExpanded(undefined)}>
                            {t('Close expanded chart')}
                          </Button>
                        </DialogActions>
                      </Dialog>
                    </Box>
                  );
                })}
              </Box>
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
        </DashboardValueFilters>
      )}
    </RequestStatus>
  );
}

export function CustomDashboardScope({ cluster }: { cluster: string }) {
  const { t } = useTranslation();
  const config = useKialiConfig();
  const settings = config.valid ? getClusterConfig(config.config, cluster) : undefined;
  const [annotationEnabled, setAnnotationEnabled] = useState(false);
  const [annotationState, setAnnotationState] = useState<DashboardAnnotationState>();
  const annotationDefaults: CustomDashboardSettings = {
    namespaceLabel: 'namespace',
    clusterLabel: 'cluster',
    dashboards: [],
  };
  const definition =
    settings?.customDashboards ?? (annotationEnabled ? annotationDefaults : undefined);
  let baseCatalog: ReturnType<typeof effectiveDashboardCatalog> | undefined;
  let catalogError: string | undefined;
  if (definition) {
    try {
      baseCatalog = effectiveDashboardCatalog(definition);
    } catch (error) {
      catalogError = error instanceof Error ? error.message : t('Dashboard catalog is unavailable');
    }
  }
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
  const annotationBinding = JSON.stringify([cluster, namespace, definition]);
  useEffect(() => setAnnotationState(undefined), [annotationBinding]);
  const annotations = annotationState?.binding === annotationBinding ? annotationState : undefined;
  const annotationBlocked = annotationEnabled && annotations?.status !== 'ready';
  const catalog = annotationEnabled
    ? annotations?.status === 'ready'
      ? annotations.data.catalog
      : undefined
    : baseCatalog;
  const binding = JSON.stringify([
    cluster,
    settings?.prometheus,
    settings?.telemetryCluster,
    definition,
    definition?.includeBuiltins ? BUILTIN_DASHBOARD_SOURCE : null,
    annotationEnabled ? [annotationBinding, annotations?.attempt, annotations?.status] : null,
  ]);
  useEffect(() => setError(''), [binding]);
  const { identity, setIdentity, query, setQuery, capturedSettings } =
    useTelemetryQuery<CustomDashboardQuery>(binding, settings);
  const discovery = useTelemetryQuery<DashboardDiscoveryQuery>(binding, settings);
  const template = catalog?.templates.find(item => item.name === selected) ?? catalog?.templates[0];
  let resolved: ReturnType<typeof resolveCustomDashboard> | undefined;
  let aggregations: DashboardAggregation[] = [];
  let resolutionError: string | undefined;
  if (template && catalog) {
    try {
      const result = resolveCustomDashboard(catalog.templates, template.name);
      aggregations = dashboardAggregationOptions(result.dashboard);
      resolved = result;
    } catch (error) {
      resolutionError =
        error instanceof Error ? error.message : t('Dashboard composition is unavailable');
    }
  }
  const dashboard = resolved?.dashboard;
  const groupingKey = JSON.stringify([binding, template?.name]);
  const [grouping, setGrouping] = useState<{ key: string; labels: string[] }>();
  useEffect(() => setGrouping(undefined), [groupingKey]);
  const byLabels = grouping?.key === groupingKey ? grouping.labels : [];
  const [chartSelection, setChartSelection] = useState<{ key: string; names: string[] }>();
  useEffect(() => setChartSelection(undefined), [groupingKey]);
  const allChartNames = dashboard?.items.map(item => item.chart.name) ?? [];
  const chartNames = chartSelection?.key === groupingKey ? chartSelection.names : allChartNames;
  const chartCost = (chart: CustomChart) =>
    customChartMetrics(chart).length * (chart.dataType === 'histogram' ? summaries.length : 1);
  const selectedCost =
    dashboard?.items.reduce(
      (sum, item) => sum + (chartNames.includes(item.chart.name) ? chartCost(item.chart) : 0),
      0
    ) ?? 0;
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
      ...(annotationEnabled && annotations?.status === 'ready'
        ? { annotationSources: structuredClone(annotations.data.sources) }
        : {}),
    };
  };
  return (
    <Stack spacing={2}>
      <SectionBox title={t('Custom aggregate dashboards')} headerProps={{ headerStyle: 'main' }}>
        <Stack spacing={2}>
          <Alert severity="info">
            {t(
              'This native dashboard view supports saved, bundled and explicitly captured annotation templates, includes, named metrics on raw/rate charts and classic histogram summaries, with optional groupLabels. Raw gauges and custom histogram observations may be negative; rates use sum(rate(...[5m])). Histogram averages use sum/count counters and quantiles use cumulative buckets, never averages of precomputed percentiles. Metrics aggregate within their selected groups; different metrics and groups are compared, not added together. Duplicate scrapes are not reconciled. Reads use 15-second samples, at most eight expanded metric queries, three concurrent requests and a 15-second deadline. Grouped responses and chart panels are limited to eight series; overflow is an error, not truncation. Missing samples are not zero or healthy. Native histograms, automatic application discovery and external dashboard links remain unsupported.'
            )}
          </Alert>
          <Link routeName="kiali-settings" params={{ cluster }}>
            {t('Configure dashboard definitions')}
          </Link>
          {definition && (
            <TextField
              label={t('Dashboard namespace')}
              sx={{ minWidth: 220 }}
              value={namespace}
              onChange={event => setNamespace(event.target.value)}
              helperText={t('Metric namespace label: {{label}}', {
                label: definition.namespaceLabel,
              })}
            />
          )}
          {config.valid && (
            <DashboardAnnotations
              key={annotationBinding}
              cluster={cluster}
              namespace={namespace}
              binding={annotationBinding}
              settings={definition ?? annotationDefaults}
              enabled={annotationEnabled}
              onEnabled={enabled => {
                setAnnotationEnabled(enabled);
                setAnnotationState(undefined);
              }}
              onState={setAnnotationState}
            />
          )}
          {!!catalog?.disabled.length && (
            <Alert severity="info">
              {annotationEnabled
                ? t(
                    'Disabled dashboard names after annotation overrides: {{names}}. Dependent includes must be updated explicitly.',
                    { names: catalog.disabled.join(', ') }
                  )
                : t(
                    'Saved disable declarations: {{names}}. These names are excluded from the effective catalog; dependent includes must be updated explicitly.',
                    { names: catalog.disabled.join(', ') }
                  )}
            </Alert>
          )}
          {definition?.includeBuiltins && (
            <Alert severity="info">
              {t(
                'Bundled catalog: Kiali {{version}}, commit {{commit}}. Saved definitions take precedence by name; the catalog does not establish metric availability or namespace/cluster identity.',
                {
                  version: BUILTIN_DASHBOARD_SOURCE.version,
                  commit: BUILTIN_DASHBOARD_SOURCE.commit,
                }
              )}
            </Alert>
          )}
          {config.valid === false ? (
            <Alert severity="error">{config.message}</Alert>
          ) : catalogError ? (
            <Alert severity="error">{catalogError}</Alert>
          ) : annotationBlocked ? (
            <Alert severity="info">
              {t(
                'Chart loading and discovery are blocked until current annotation sources are captured successfully. Read the sources again or turn off annotation overrides explicitly.'
              )}
            </Alert>
          ) : !catalog?.templates.length ? (
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
                  {catalog.templates.map(item => (
                    <MenuItem key={item.name} value={item.name}>
                      {item.title || item.name}
                      {catalog.origins.get(item.name) === 'builtin' ? t(' (built-in)') : ''}
                    </MenuItem>
                  ))}
                </TextField>
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
              {!!aggregations.length && (
                <Stack spacing={1} role="group" aria-label={t('Optional metric grouping')}>
                  <Typography>
                    {t(
                      'Optional grouping from aggregation declarations applies on the next explicit load, in addition to fixed groupLabels. Captured label values can be hidden separately without refetching.'
                    )}
                  </Typography>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    {aggregations.map(option => (
                      <FormControlLabel
                        key={option.label}
                        label={t('Group by {{name}} ({{label}})', {
                          name: option.displayName,
                          label: option.label,
                        })}
                        control={
                          <Checkbox
                            checked={byLabels.includes(option.label)}
                            onChange={event => {
                              const checked = event.target.checked;
                              setGrouping(current => {
                                const previous = current?.key === groupingKey ? current.labels : [];
                                return {
                                  key: groupingKey,
                                  labels: checked
                                    ? [...previous, option.label]
                                    : previous.filter(label => label !== option.label),
                                };
                              });
                            }}
                          />
                        }
                      />
                    ))}
                  </Stack>
                </Stack>
              )}
              {dashboard && dashboard.items.length > 1 && (
                <details open={dashboard.items.length > 8}>
                  <summary>
                    {t('Choose dashboard charts ({{selected}} of {{total}} selected)', {
                      selected: chartNames.length,
                      total: dashboard.items.length,
                    })}
                  </summary>
                  <Typography variant="body2">
                    {t(
                      'All charts start selected. Narrow the selection explicitly when it exceeds eight expanded metric requests; no charts are silently dropped. Histogram summaries and named metrics count separately.'
                    )}
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <Button
                      onClick={() =>
                        setChartSelection({ key: groupingKey, names: [...allChartNames] })
                      }
                    >
                      {t('Select all dashboard charts')}
                    </Button>
                    <Button onClick={() => setChartSelection({ key: groupingKey, names: [] })}>
                      {t('Clear chart selection')}
                    </Button>
                  </Stack>
                  <Stack spacing={0.5}>
                    {dashboard.items.map(({ chart }) => (
                      <Stack key={chart.name} direction="row" spacing={1} alignItems="center">
                        <FormControlLabel
                          label={t('Include chart {{name}}', { name: chart.name })}
                          control={
                            <Checkbox
                              checked={chartNames.includes(chart.name)}
                              onChange={event => {
                                const checked = event.target.checked;
                                setChartSelection(current => {
                                  const previous =
                                    current?.key === groupingKey ? current.names : allChartNames;
                                  return {
                                    key: groupingKey,
                                    names: checked
                                      ? [...previous, chart.name]
                                      : previous.filter(name => name !== chart.name),
                                  };
                                });
                              }}
                            />
                          }
                        />
                        <Typography variant="caption">
                          {t('Expanded requests: {{count}}', { count: chartCost(chart) })}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                </details>
              )}
              {dashboard && (
                <Typography variant="body2">
                  {t(
                    'Selected charts: {{charts}}. Expanded metric requests: {{requests}} of 8 maximum.',
                    { charts: chartNames.length, requests: selectedCost }
                  )}
                </Typography>
              )}
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
                    if (!dashboard || !resolved || !catalog)
                      throw new Error(resolutionError ?? t('Choose a configured dashboard'));
                    const next: CustomDashboardQuery = {
                      ...captureScope(),
                      dashboard: structuredClone(dashboard),
                      chartNames: dashboard.items
                        .filter(item => chartNames.includes(item.chart.name))
                        .map(item => item.chart.name),
                      byLabels: aggregations
                        .filter(option => byLabels.includes(option.label))
                        .map(option => option.label),
                      templateReferences: resolved.references.map(reference => {
                        const origin = catalog.origins.get(reference.name);
                        if (!origin)
                          throw new Error(t('Dashboard definition source is unavailable'));
                        return { ...reference, origin };
                      }),
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
              {catalog.templates.some(template => template.discoverOn) && (
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
                          templates: structuredClone(catalog.templates),
                          templateSources: [...catalog.origins].map(([name, origin]) => ({
                            name,
                            origin,
                          })),
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
