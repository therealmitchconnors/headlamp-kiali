import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
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
import { customDashboardJobs, CustomDashboardQuery } from '../core/customDashboards';
import { clusterScope } from '../core/scope';
import { loadCustomDashboard } from '../data/customDashboards';
import { useRequest } from '../hooks/useRequest';
import { useTelemetryQuery } from '../hooks/useTelemetryQuery';
import ClusterScope from './ClusterScope';
import MetricChart from './MetricChart';
import RequestStatus from './RequestStatus';

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
                  'No metric cluster selector was sent. You explicitly confirmed this source contains only one cluster; the plugin cannot verify that assertion.'
                )}
          </Alert>
          {data.charts.map(({ key, chart, read }) => (
            <SectionBox key={key} title={chart.name}>
              <Typography variant="body2">
                {t(
                  'Metric: {{metric}}; data type: {{type}}; aggregation: {{aggregation}}; unit scale: {{scale}}',
                  {
                    metric: chart.metricName,
                    type: chart.dataType,
                    aggregation: chart.aggregator ?? 'sum',
                    scale: chart.unitScale ?? 1,
                  }
                )}
              </Typography>
              {read.ok === false ? (
                <Alert severity="error">{read.error.message}</Alert>
              ) : (
                <>
                  {!!read.result.warnings.length && (
                    <Alert severity="warning">{read.result.warnings.join('; ')}</Alert>
                  )}
                  <MetricChart result={read.result} title={chart.name} unit={chart.unit} />
                </>
              )}
            </SectionBox>
          ))}
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
  const dashboard =
    definition?.dashboards.find(item => item.name === selected) ?? definition?.dashboards[0];
  return (
    <Stack spacing={2}>
      <SectionBox title={t('Custom aggregate dashboards')} headerProps={{ headerStyle: 'main' }}>
        <Stack spacing={2}>
          <Alert severity="info">
            {t(
              'This initial native dashboard view supports aggregate raw gauges and counter rates from saved definitions. Raw values may be negative; rate charts use sum(rate(...[5m])). All matching series are aggregated; duplicate scrapes and metric-specific labels are not reconciled. Reads use 15-second samples, at most three concurrent queries and a 15-second deadline. Missing samples are not zero or healthy. Includes, grouping, histograms, built-in discovery, annotation overrides and external dashboard links remain unsupported.'
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
                  value={dashboard?.name ?? ''}
                  onChange={event => setSelected(event.target.value)}
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
                    if (!dashboard) throw new Error(t('Choose a configured dashboard'));
                    const next: CustomDashboardQuery = {
                      namespace,
                      metricCluster: identity,
                      minutes,
                      end: current
                        ? Math.floor(Date.now() / 1000)
                        : Math.floor(new Date(endTime).getTime() / 1000),
                      namespaceLabel: definition.namespaceLabel,
                      clusterLabel: definition.clusterLabel,
                      singleClusterConfirmed: acknowledged === binding,
                      dashboard: structuredClone(dashboard),
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
            </>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </SectionBox>
      {query && capturedSettings?.prometheus && (
        <DashboardResults cluster={cluster} endpoint={capturedSettings.prometheus} query={query} />
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
