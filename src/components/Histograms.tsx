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
import { useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useKialiConfig } from '../config';
import { getClusterConfig, ServiceEndpoint } from '../core/config';
import {
  HISTOGRAM_SUMMARIES,
  histogramQueries,
  HistogramQuery,
  HistogramSummary,
  TRAFFIC_HISTOGRAMS,
} from '../core/histograms';
import { clusterScope } from '../core/scope';
import { loadHistograms } from '../data/histograms';
import { useRequest } from '../hooks/useRequest';
import { useTelemetryQuery } from '../hooks/useTelemetryQuery';
import ClusterScope from './ClusterScope';
import MetricChart from './MetricChart';
import RequestStatus from './RequestStatus';

function useHistogramLabels() {
  const { t } = useTranslation();
  return {
    metrics: {
      duration: t('Request duration'),
      requestSize: t('Request size'),
      responseSize: t('Response size'),
    },
    summaries: { avg: t('Average'), p50: 'P50', p90: 'P90', p95: 'P95', p99: 'P99' },
  };
}
function HistogramResults({
  cluster,
  endpoint,
  query,
}: {
  cluster: string;
  endpoint: ServiceEndpoint;
  query: HistogramQuery;
}) {
  const { t } = useTranslation();
  const labels = useHistogramLabels();
  const load = useCallback(
    (signal: AbortSignal) => loadHistograms(clusterScope(cluster), endpoint, query, signal),
    [cluster, endpoint, query]
  );
  const result = useRequest(JSON.stringify([cluster, endpoint, query]), load);
  return (
    <RequestStatus state={result} loadingLabel={t('Loading histogram summaries...')}>
      {snapshot => (
        <Stack spacing={2}>
          <Typography>
            {t(
              'Captured histogram: {{metric}}; namespace {{namespace}}; metric cluster {{cluster}}; ending {{time}}',
              {
                metric: labels.metrics[snapshot.query.metric],
                namespace: snapshot.query.namespace,
                cluster: snapshot.query.telemetryCluster,
                time: new Date(snapshot.query.end * 1000).toISOString(),
              }
            )}
          </Typography>
          {snapshot.summaries.map(({ summary, read }) => {
            const title = `${labels.metrics[snapshot.query.metric]} - ${labels.summaries[summary]}`;
            return (
              <SectionBox key={summary} title={title}>
                {read.ok === false ? (
                  <Alert severity="error">{read.error.message}</Alert>
                ) : (
                  <>
                    {!!read.result.warnings.length && (
                      <Alert severity="warning">{read.result.warnings.join('; ')}</Alert>
                    )}
                    <MetricChart
                      result={read.result}
                      title={title}
                      unit={TRAFFIC_HISTOGRAMS[snapshot.query.metric].unit}
                    />
                  </>
                )}
              </SectionBox>
            );
          })}
        </Stack>
      )}
    </RequestStatus>
  );
}
function HistogramScope({ cluster }: { cluster: string }) {
  const { t } = useTranslation();
  const labels = useHistogramLabels();
  const config = useKialiConfig();
  const params = new URLSearchParams(useLocation().search);
  const settings = config.valid ? getClusterConfig(config.config, cluster) : undefined;
  const [namespace, setNamespace] = useState(params.get('namespace') ?? '');
  const [workload, setWorkload] = useState('');
  const [metric, setMetric] = useState<HistogramQuery['metric']>('duration');
  const [summaries, setSummaries] = useState<HistogramSummary[]>(['avg', 'p95']);
  const [direction, setDirection] = useState<HistogramQuery['direction']>('inbound');
  const [minutes, setMinutes] = useState<HistogramQuery['minutes']>(15);
  const [current, setCurrent] = useState(true);
  const [endTime, setEndTime] = useState('');
  const [error, setError] = useState('');
  const { identity, setIdentity, query, setQuery, capturedSettings } =
    useTelemetryQuery<HistogramQuery>(
      JSON.stringify([cluster, settings?.prometheus, settings?.telemetryCluster]),
      settings
    );
  return (
    <Stack spacing={2}>
      <SectionBox title={t('Traffic histogram summaries')} headerProps={{ headerStyle: 'main' }}>
        <Stack spacing={2}>
          <Alert severity="info">
            {t(
              'Histogram summaries use one reporter, a five-minute rate window and 15-second samples. Quantiles aggregate buckets before estimation; averages use rate(sum)/rate(count), not an average of per-series percentiles. Missing and non-finite samples remain unavailable. These are observations, not health verdicts.'
            )}
          </Alert>
          <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap">
            <TextField
              label={t('Namespace')}
              value={namespace}
              onChange={event => setNamespace(event.target.value)}
            />
            <TextField
              label={t('Istio metric cluster label')}
              value={identity}
              onChange={event => setIdentity(event.target.value)}
            />
            <TextField
              label={t('Workload filter (optional)')}
              value={workload}
              onChange={event => setWorkload(event.target.value)}
            />
            <TextField
              select
              label={t('Histogram metric')}
              value={metric}
              onChange={event => {
                const metric = event.target.value;
                if (metric === 'duration' || metric === 'requestSize' || metric === 'responseSize')
                  setMetric(metric);
              }}
            >
              {(['duration', 'requestSize', 'responseSize'] as const).map(metric => (
                <MenuItem key={metric} value={metric}>
                  {labels.metrics[metric]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label={t('Direction')}
              value={direction}
              onChange={event => {
                if (event.target.value === 'inbound' || event.target.value === 'outbound')
                  setDirection(event.target.value);
              }}
            >
              <MenuItem value="inbound">{t('Inbound')}</MenuItem>
              <MenuItem value="outbound">{t('Outbound')}</MenuItem>
            </TextField>
            <TextField
              select
              label={t('Time range')}
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
          <Stack direction="row" spacing={1}>
            {HISTOGRAM_SUMMARIES.map(summary => (
              <FormControlLabel
                key={summary}
                label={labels.summaries[summary]}
                control={
                  <Checkbox
                    checked={summaries.includes(summary)}
                    onChange={event =>
                      setSummaries(values =>
                        event.target.checked
                          ? [...values, summary]
                          : values.filter(value => value !== summary)
                      )
                    }
                  />
                }
              />
            ))}
          </Stack>
          <FormControlLabel
            label={t('Use current histogram time')}
            control={
              <Checkbox checked={current} onChange={event => setCurrent(event.target.checked)} />
            }
          />
          {!current && (
            <TextField
              type="datetime-local"
              label={t('Histogram end time (local time)')}
              InputLabelProps={{ shrink: true }}
              value={endTime}
              onChange={event => setEndTime(event.target.value)}
            />
          )}
          <Typography>
            {t(
              'Up to five summaries run with at most three requests in flight and a 15-second whole-read deadline. Endpoint or saved-identity changes clear submitted results; changing draft controls does not issue requests.'
            )}
          </Typography>
          <Button
            variant="contained"
            disabled={!settings?.prometheus || !summaries.length}
            onClick={() => {
              try {
                const end = current
                  ? Math.floor(Date.now() / 1000)
                  : Math.floor(new Date(endTime).getTime() / 1000);
                if (end > Math.floor(Date.now() / 1000))
                  throw new Error(t('Choose a histogram time that is not in the future'));
                const query: HistogramQuery = {
                  namespace,
                  telemetryCluster: identity,
                  ...(workload ? { workload } : {}),
                  metric,
                  summaries: [...summaries],
                  direction,
                  minutes,
                  end,
                };
                histogramQueries(query);
                setQuery(query);
                setError('');
              } catch (error) {
                setError(error instanceof Error ? error.message : t('Invalid histogram query'));
              }
            }}
          >
            {t('Load histogram summaries')}
          </Button>
          {error && <Alert severity="error">{error}</Alert>}
          {config.valid === false && <Alert severity="error">{config.message}</Alert>}
          {!settings?.prometheus && (
            <Alert severity="info">
              {t('Configure an existing Prometheus Service before loading metrics.')}{' '}
              <Link routeName="kiali-settings">{t('Connection settings')}</Link>
            </Alert>
          )}
        </Stack>
      </SectionBox>
      {query && capturedSettings?.prometheus && (
        <HistogramResults cluster={cluster} endpoint={capturedSettings.prometheus} query={query} />
      )}
    </Stack>
  );
}
export default function Histograms() {
  return (
    <ClusterScope>
      {scope => <HistogramScope key={scope.cluster} cluster={scope.cluster} />}
    </ClusterScope>
  );
}
