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
import { clusterScope } from '../core/scope';
import {
  SignalQuery,
  TRAFFIC_SIGNAL_KEYS,
  TRAFFIC_SIGNALS,
  TrafficSignal,
  trafficSignalQueries,
} from '../core/trafficSignals';
import { loadTrafficSignals } from '../data/trafficSignals';
import { useRequest } from '../hooks/useRequest';
import { useTelemetryQuery } from '../hooks/useTelemetryQuery';
import ClusterScope from './ClusterScope';
import MetricChart from './MetricChart';
import RequestStatus from './RequestStatus';

function useSignalLabels() {
  const { t } = useTranslation();
  return {
    request_throughput: t('Request throughput'),
    response_throughput: t('Response throughput'),
    grpc_sent: t('gRPC request message rate'),
    grpc_received: t('gRPC response message rate'),
    tcp_sent: t('TCP sent byte rate (Kiali mapping)'),
    tcp_received: t('TCP received byte rate (Kiali mapping)'),
    tcp_opened: t('TCP connection open rate'),
    tcp_closed: t('TCP connection close rate'),
  };
}
function SignalResults({
  cluster,
  endpoint,
  query,
}: {
  cluster: string;
  endpoint: ServiceEndpoint;
  query: SignalQuery;
}) {
  const { t } = useTranslation();
  const labels = useSignalLabels();
  const load = useCallback(
    (signal: AbortSignal) => loadTrafficSignals(clusterScope(cluster), endpoint, query, signal),
    [cluster, endpoint, query]
  );
  const state = useRequest(JSON.stringify([cluster, endpoint, query]), load);
  return (
    <RequestStatus state={state} loadingLabel={t('Loading traffic signals...')}>
      {snapshot => (
        <Stack spacing={2}>
          <Typography>
            {t(
              'Captured signals: namespace {{namespace}}; metric cluster {{cluster}}; ending {{time}}',
              {
                namespace: snapshot.query.namespace,
                cluster: snapshot.query.telemetryCluster,
                time: new Date(snapshot.query.end * 1000).toISOString(),
              }
            )}
          </Typography>
          {snapshot.metrics.map(({ key, read }) => (
            <SectionBox key={key} title={labels[key]}>
              <Typography variant="body2">
                {t('Raw Istio metric')}: <code>{TRAFFIC_SIGNALS[key].metric}</code>
              </Typography>
              {read.ok === false ? (
                <Alert severity="error">{read.error.message}</Alert>
              ) : (
                <>
                  {!!read.result.warnings.length && (
                    <Alert severity="warning">{read.result.warnings.join('; ')}</Alert>
                  )}
                  <MetricChart
                    title={labels[key]}
                    result={read.result}
                    unit={TRAFFIC_SIGNALS[key].unit}
                  />
                </>
              )}
            </SectionBox>
          ))}
        </Stack>
      )}
    </RequestStatus>
  );
}
function SignalScope({ cluster }: { cluster: string }) {
  const { t } = useTranslation();
  const labels = useSignalLabels();
  const config = useKialiConfig();
  const settings = config.valid ? getClusterConfig(config.config, cluster) : undefined;
  const params = new URLSearchParams(useLocation().search);
  const [namespace, setNamespace] = useState(params.get('namespace') ?? '');
  const [workload, setWorkload] = useState('');
  const [signals, setSignals] = useState<TrafficSignal[]>([
    'request_throughput',
    'response_throughput',
  ]);
  const [direction, setDirection] = useState<SignalQuery['direction']>('inbound');
  const [minutes, setMinutes] = useState<SignalQuery['minutes']>(15);
  const [current, setCurrent] = useState(true);
  const [endTime, setEndTime] = useState('');
  const [error, setError] = useState('');
  const { identity, setIdentity, query, setQuery, capturedSettings } =
    useTelemetryQuery<SignalQuery>(
      JSON.stringify([cluster, settings?.prometheus, settings?.telemetryCluster]),
      settings
    );
  return (
    <Stack spacing={2}>
      <SectionBox title={t('Traffic signal rates')} headerProps={{ headerStyle: 'main' }}>
        <Stack spacing={2}>
          <Alert severity="info">
            {t(
              'These per-second rates use one reporter, five-minute rate windows and 15-second samples. Connection open/close rates are not active connection counts. Missing and non-finite samples remain unavailable; zero rates do not prove absence or health.'
            )}
          </Alert>
          <Alert severity="info">
            {t(
              'TCP sent/received labels follow pinned Kiali compensation for reversed Istio L4 counter names. Raw metric names are shown for every panel; this is not a claim about wire direction on every Istio version. The original Traffic metrics raw TCP panel is unchanged.'
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
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {TRAFFIC_SIGNAL_KEYS.map(signal => (
              <FormControlLabel
                key={signal}
                label={labels[signal]}
                control={
                  <Checkbox
                    checked={signals.includes(signal)}
                    onChange={event =>
                      setSignals(values =>
                        event.target.checked
                          ? [...values, signal]
                          : values.filter(value => value !== signal)
                      )
                    }
                  />
                }
              />
            ))}
          </Stack>
          <FormControlLabel
            label={t('Use current signal time')}
            control={
              <Checkbox checked={current} onChange={event => setCurrent(event.target.checked)} />
            }
          />
          {!current && (
            <TextField
              type="datetime-local"
              label={t('Signal end time (local time)')}
              InputLabelProps={{ shrink: true }}
              value={endTime}
              onChange={event => setEndTime(event.target.value)}
            />
          )}
          <Typography variant="body2">
            {t(
              'Up to eight signals run with at most three requests in flight and one 15-second deadline. Draft edits do not refetch or relabel results; connection or saved-identity changes discard submissions.'
            )}
          </Typography>
          <Button
            variant="contained"
            disabled={!settings?.prometheus || !signals.length}
            onClick={() => {
              try {
                const end = current
                  ? Math.floor(Date.now() / 1000)
                  : Math.floor(new Date(endTime).getTime() / 1000);
                if (end > Math.floor(Date.now() / 1000))
                  throw new Error(t('Choose a signal time that is not in the future'));
                const query: SignalQuery = {
                  namespace,
                  telemetryCluster: identity,
                  ...(workload ? { workload } : {}),
                  signals: [...signals],
                  direction,
                  minutes,
                  end,
                };
                trafficSignalQueries(query);
                setQuery(query);
                setError('');
              } catch (error) {
                setError(
                  error instanceof Error ? error.message : t('Invalid traffic signal query')
                );
              }
            }}
          >
            {t('Load traffic signals')}
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
        <SignalResults cluster={cluster} endpoint={capturedSettings.prometheus} query={query} />
      )}
    </Stack>
  );
}
export default function TrafficSignals() {
  return (
    <ClusterScope>
      {scope => <SignalScope key={scope.cluster} cluster={scope.cluster} />}
    </ClusterScope>
  );
}
