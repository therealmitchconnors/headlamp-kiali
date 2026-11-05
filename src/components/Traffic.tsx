import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
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
  MetricResult,
  prometheusQueries,
  requestPoints,
  securityTelemetry,
  trafficEdges,
  TrafficQuery,
} from '../core/telemetry';
import { loadTelemetry, MetricRead } from '../data/telemetry';
import { useRequest } from '../hooks/useRequest';
import { useTelemetryQuery } from '../hooks/useTelemetryQuery';
import ClusterScope from './ClusterScope';
import MetricChart from './MetricChart';
import RequestStatus from './RequestStatus';
import TrafficGraph from './TrafficGraph';

function MetricView({
  read,
  children,
}: {
  read: MetricRead;
  children: (result: MetricResult) => React.ReactNode;
}) {
  const { t } = useTranslation();
  if (read.ok === false) return <Alert severity="error">{read.error.message}</Alert>;
  if (!read.result.series.length)
    return (
      <Alert severity="info">
        {t('No metric series were returned. This is not a healthy-status result.')}
      </Alert>
    );
  return (
    <>
      {read.result.warnings.length > 0 && (
        <Alert severity="warning">
          {t('Prometheus returned warnings; results may be incomplete.')}{' '}
          {read.result.warnings.join('; ')}
        </Alert>
      )}
      {children(read.result)}
    </>
  );
}

function Results({
  cluster,
  endpoint,
  query,
}: {
  cluster: string;
  endpoint: ServiceEndpoint;
  query: TrafficQuery;
}) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) => loadTelemetry(clusterScope(cluster), endpoint, query, signal),
    [cluster, endpoint, query]
  );
  const result = useRequest(JSON.stringify([cluster, endpoint, query]), load);
  return (
    <RequestStatus state={result} loadingLabel={t('Loading traffic metrics...')}>
      {snapshot => (
        <>
          <SectionBox title={t('HTTP and gRPC requests')}>
            <MetricView read={snapshot.requests}>
              {data => {
                const points = requestPoints(data);
                return (
                  <>
                    <MetricChart
                      title={t('Request rate over time')}
                      unit={t('Requests / second')}
                      result={{
                        warnings: [],
                        series: [
                          {
                            labels: {},
                            samples: points.map(point => ({
                              timestamp: point.timestamp,
                              value: point.requests,
                            })),
                          },
                        ],
                      }}
                    />
                    <SimpleTable
                      data={points.slice(-1)}
                      columns={[
                        {
                          label: t('Latest requests / second'),
                          getter: (point: (typeof points)[number]) =>
                            point.requests === null
                              ? t('Unavailable')
                              : point.requests.toPrecision(5),
                        },
                        {
                          label: t('Latest error percent'),
                          getter: (point: (typeof points)[number]) =>
                            point.errorPercent === null
                              ? t('Unavailable')
                              : point.errorPercent.toFixed(2),
                        },
                      ]}
                    />
                    <Typography variant="body2">
                      {t(
                        'Errors count HTTP 4xx/5xx and nonzero gRPC statuses. This is not the configurable Kiali health calculation.'
                      )}
                    </Typography>
                  </>
                );
              }}
            </MetricView>
          </SectionBox>
          <SectionBox title={t('95th percentile request duration')}>
            <MetricView read={snapshot.latency}>
              {data => (
                <MetricChart
                  result={data}
                  title={t('95th percentile request duration')}
                  unit={t('Milliseconds')}
                />
              )}
            </MetricView>
          </SectionBox>
          <SectionBox title={t('TCP sent throughput')}>
            <Typography variant="body2">
              {t(
                'This panel retains the raw istio_tcp_sent_bytes_total counter. Traffic signals shows the separate pinned Kiali L4 direction mapping.'
              )}
            </Typography>
            <MetricView read={snapshot.tcp}>
              {data => (
                <MetricChart
                  result={data}
                  title={t('TCP sent throughput')}
                  unit={t('Bytes / second')}
                />
              )}
            </MetricView>
          </SectionBox>
          <SectionBox title={t('Observed workload connections')}>
            <MetricView read={snapshot.traffic}>
              {data => {
                const edges = trafficEdges(data);
                return (
                  <>
                    <TrafficGraph traffic={edges} />
                    <SimpleTable
                      data={edges}
                      emptyMessage={t(
                        'No positive request rates were observed in the selected window.'
                      )}
                      columns={[
                        {
                          label: t('Source cluster / namespace / workload'),
                          getter: (edge: (typeof edges)[number]) =>
                            `${edge.source.cluster} / ${edge.source.namespace} / ${edge.source.workload}`,
                        },
                        {
                          label: t('Destination cluster / namespace / workload'),
                          getter: (edge: (typeof edges)[number]) =>
                            `${edge.destination.cluster} / ${edge.destination.namespace} / ${edge.destination.workload}`,
                        },
                        {
                          label: t('Protocol'),
                          getter: (edge: (typeof edges)[number]) => edge.protocol,
                        },
                        {
                          label: t('Requests / second'),
                          getter: (edge: (typeof edges)[number]) => edge.rate.toPrecision(5),
                        },
                      ]}
                    />
                  </>
                );
              }}
            </MetricView>
          </SectionBox>
          <SectionBox title={t('Observed connection security')}>
            <Alert severity="info">
              {t(
                'This is a destination-reported istio_requests_total view for the selected namespace and explicit telemetry identity, regardless of inbound/outbound scope. It uses a five-minute rate window over the captured range, sampled every 15 seconds. Categories describe returned HTTP/gRPC request labels only; they do not prove all traffic, configured policy, proxy synchronization, certificate validity, authorization, or ambient/waypoint security. TCP and ambient security are unsupported by this request-level query.'
              )}
            </Alert>
            <Typography variant="body2">
              {t(
                'Reporter: destination; namespace: {{namespace}}; metric cluster: {{cluster}}; range: {{minutes}} minutes ending {{time}}',
                {
                  namespace: query.namespace,
                  cluster: query.telemetryCluster,
                  minutes: query.minutes,
                  time: new Date(query.end * 1000).toISOString(),
                }
              )}
            </Typography>
            <MetricView read={snapshot.security}>
              {data => {
                const projection = securityTelemetry(data, query);
                const categories = {
                  encrypted: t('mTLS-labeled observations'),
                  plaintext: t('none-labeled observations'),
                  mixed: t('Both mTLS and none labels observed'),
                  unknown: t('Unknown labels or incomplete samples'),
                  unsupported: t('Unsupported protocol'),
                  unavailable: t('Unavailable (no positive sample)'),
                };
                return (
                  <Stack spacing={2}>
                    <SimpleTable
                      data={projection.protocols}
                      columns={[
                        { label: t('Protocol'), getter: row => row.protocol },
                        {
                          label: t('Observed category over range'),
                          getter: row => categories[row.category],
                        },
                        {
                          label: t('Sample availability'),
                          getter: row =>
                            row.completeness === 'available'
                              ? t('Available')
                              : row.completeness === 'partial'
                              ? t('Partial')
                              : t('Unavailable'),
                        },
                        {
                          label: t('Latest sample time'),
                          getter: row =>
                            row.timestamp === null
                              ? t('Unavailable')
                              : new Date(row.timestamp * 1000).toISOString(),
                        },
                      ]}
                    />
                    <SimpleTable
                      data={projection.rates}
                      columns={[
                        { label: t('Protocol'), getter: row => row.protocol },
                        {
                          label: t('Reported connection security policy label'),
                          getter: row => row.policy,
                        },
                        {
                          label: t('Latest requests / second'),
                          getter: row =>
                            row.rate === null ? t('Unavailable') : row.rate.toPrecision(5),
                        },
                        {
                          label: t('Share of returned same-protocol rates (%)'),
                          getter: row =>
                            row.observedPercent === null
                              ? t('Unavailable')
                              : row.observedPercent.toFixed(2),
                        },
                        {
                          label: t('Latest sample time'),
                          getter: row =>
                            row.timestamp === null
                              ? t('Unavailable')
                              : new Date(row.timestamp * 1000).toISOString(),
                        },
                      ]}
                    />
                  </Stack>
                );
              }}
            </MetricView>
          </SectionBox>
        </>
      )}
    </RequestStatus>
  );
}

function TrafficScope({ cluster }: { cluster: string }) {
  const { t } = useTranslation();
  const config = useKialiConfig();
  const location = useLocation();
  const [namespace, setNamespace] = useState(
    new URLSearchParams(location.search).get('namespace') ?? ''
  );
  const [direction, setDirection] = useState<'inbound' | 'outbound'>('inbound');
  const [minutes, setMinutes] = useState<5 | 15 | 60>(15);
  const [error, setError] = useState('');
  const settings = config.valid ? getClusterConfig(config.config, cluster) : undefined;
  const endpoint = settings?.prometheus ?? null;
  const {
    identity: telemetryCluster,
    setIdentity: setTelemetryCluster,
    query,
    setQuery,
    capturedSettings,
  } = useTelemetryQuery<TrafficQuery>(
    JSON.stringify([cluster, endpoint, settings?.telemetryCluster]),
    settings
  );
  return (
    <>
      <SectionBox title={t('Traffic metrics')} headerProps={{ headerStyle: 'main' }}>
        <Stack spacing={2}>
          <Link routeName="kiali-graph" search={new URLSearchParams({ namespace }).toString()}>
            {t('Open traffic graph projections')}
          </Link>
          <Link routeName="kiali-histograms" search={new URLSearchParams({ namespace }).toString()}>
            {t('Open traffic histogram summaries')}
          </Link>
          <Link routeName="kiali-signals" search={new URLSearchParams({ namespace }).toString()}>
            {t('Open throughput, gRPC and TCP signals')}
          </Link>
          <Alert severity="info">
            {t(
              'Choose the exact Istio metric cluster label; it is not assumed to equal the Headlamp cluster name. One reporter is selected to avoid counting both sides of each request.'
            )}
          </Alert>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <TextField
              label={t('Namespace')}
              value={namespace}
              onChange={event => setNamespace(event.target.value)}
            />
            <TextField
              label={t('Istio metric cluster label')}
              value={telemetryCluster}
              onChange={event => setTelemetryCluster(event.target.value)}
              helperText={t(
                'Uses the saved explicit identity when available. Editing this form does not change settings. Endpoint or saved-identity changes clear submitted queries.'
              )}
            />
            <TextField
              select
              label={t('Direction')}
              value={direction}
              onChange={event =>
                setDirection(event.target.value === 'outbound' ? 'outbound' : 'inbound')
              }
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
                else setError(t('Unsupported time range'));
              }}
            >
              {[5, 15, 60].map(value => (
                <MenuItem key={value} value={value}>
                  {t('{{count}} minutes', { count: value })}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <Button
            sx={{ alignSelf: 'flex-start' }}
            variant="contained"
            disabled={!endpoint}
            onClick={() => {
              const next: TrafficQuery = {
                namespace,
                telemetryCluster,
                direction,
                minutes,
                end: Math.floor(Date.now() / 1000),
              };
              try {
                prometheusQueries(next);
                setQuery(next);
                setError('');
              } catch (error) {
                setError(error instanceof Error ? error.message : t('Invalid query'));
              }
            }}
          >
            {t('Load metrics')}
          </Button>
          <Typography variant="body2">
            {t(
              'The complete metrics read stops after 15 seconds. A timeout does not imply zero traffic; retry explicitly after checking connectivity.'
            )}
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          {config.valid === false ? (
            <Alert severity="error">{config.message}</Alert>
          ) : (
            !endpoint && (
              <Alert severity="info">
                {t('Configure an existing Prometheus Service before loading metrics.')}{' '}
                <Link routeName="kiali-settings">{t('Connection settings')}</Link>
              </Alert>
            )
          )}
          {query && (
            <Typography>
              {t('Displayed query: {{namespace}}, {{cluster}}, {{direction}}, ending {{time}}', {
                namespace: query.namespace,
                cluster: query.telemetryCluster,
                direction: query.direction,
                time: new Date(query.end * 1000).toLocaleString(),
              })}
            </Typography>
          )}
        </Stack>
      </SectionBox>
      {capturedSettings?.prometheus && query && (
        <Results cluster={cluster} endpoint={capturedSettings.prometheus} query={query} />
      )}
    </>
  );
}

export default function Traffic() {
  return (
    <ClusterScope>
      {scope => <TrafficScope key={scope.cluster} cluster={scope.cluster} />}
    </ClusterScope>
  );
}
