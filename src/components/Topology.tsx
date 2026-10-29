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
import { useCallback, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useKialiConfig } from '../config';
import { getClusterConfig, ServiceEndpoint } from '../core/config';
import { clusterScope } from '../core/scope';
import {
  filterTopology,
  projectTopology,
  TopologyEdge,
  TopologyMode,
  topologyNamespacePosition,
  TopologyNode,
  TopologyObservations,
  topologyQueries,
  TopologyQuery,
  topologyUnit,
  TopologyWarning,
} from '../core/topology';
import { loadTopology } from '../data/topology';
import { useRequest } from '../hooks/useRequest';
import { useTelemetryQuery } from '../hooks/useTelemetryQuery';
import ClusterScope from './ClusterScope';
import GraphResources from './GraphResources';
import RequestStatus from './RequestStatus';
import { TrafficDiagram } from './TrafficGraph';

const name = (node: TopologyNode) => `${node.cluster} / ${node.namespace} / ${node.label}`;

function Warning({ warning }: { warning: TopologyWarning }) {
  const { t } = useTranslation();
  switch (warning.code) {
    case 'prometheus':
      return <Typography>{warning.message}</Typography>;
    case 'missing-label':
      return (
        <Typography>
          {t('Missing {{label}}; affected endpoint information is unknown', {
            label: warning.label,
          })}
        </Typography>
      );
    case 'omitted-paths':
      return (
        <Typography>
          {t('{{count}} observations had no retained service-graph path', { count: warning.count })}
        </Typography>
      );
    case 'service-aliases':
      return (
        <Typography>
          {t(
            'A workload backs multiple observed Services; projected outgoing rates repeat across those Service aliases'
          )}
        </Typography>
      );
    case 'service-projection':
      return (
        <Typography>
          {t(
            'Service edges are structural projections through observed workloads, not traced service-to-service attribution; rates are not additive across Service aliases'
          )}
        </Typography>
      );
    case 'conflicting-revisions':
      return (
        <Typography>
          {t(
            'A workload-backed versioned application has conflicting application/revision labels; inspect its observed labels'
          )}
        </Typography>
      );
  }
}

function Distribution({
  title,
  rates,
  unit,
}: {
  title: string;
  rates: Record<string, number>;
  unit: string;
}) {
  const { t } = useTranslation();
  return (
    <SectionBox title={title}>
      <SimpleTable
        data={Object.entries(rates)}
        emptyMessage={t('Not reported for this measure')}
        columns={[
          {
            label: t('Reported value'),
            getter: ([value]: [string, number]) => value || t('Empty reported value'),
          },
          { label: unit, getter: ([, rate]: [string, number]) => rate.toPrecision(5) },
        ]}
      />
    </SectionBox>
  );
}

export function TopologyResults({
  snapshot,
  cluster,
}: {
  snapshot: TopologyObservations & { query: TopologyQuery };
  cluster?: string;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<TopologyMode>('workload');
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<{ kind: 'node' | 'edge'; id: string }>();
  const projected = useMemo(() => {
    try {
      return { graph: projectTopology(snapshot, mode), error: '' };
    } catch (error) {
      return {
        graph: undefined,
        error: error instanceof Error ? error.message : 'Topology projection failed',
      };
    }
  }, [snapshot, mode]);
  const graph = useMemo(
    () => (projected.graph ? filterTopology(projected.graph, search) : undefined),
    [projected.graph, search]
  );
  const unitKind = topologyUnit(snapshot.query.measure);
  const unit =
    unitKind === 'requests'
      ? t('Requests / second')
      : unitKind === 'bytes'
      ? t('Bytes / second')
      : t('Messages / second');
  const node =
    selection?.kind === 'node' ? graph?.nodes.find(node => node.id === selection.id) : undefined;
  const edge =
    selection?.kind === 'edge' ? graph?.edges.find(edge => edge.id === selection.id) : undefined;
  const nodeNames = new Map(graph?.nodes.map(node => [node.id, name(node)]));
  const namespaceCaption = (node: TopologyNode) => {
    const position = topologyNamespacePosition(node, snapshot.query.namespace);
    return position === 'selected'
      ? t('Selected namespace')
      : position === 'outside'
      ? t('Outside selected namespace')
      : t('Namespace not established');
  };
  return (
    <Stack spacing={2}>
      <Typography>
        {t(
          'Snapshot: {{namespace}} / {{cluster}}, reporter {{reporter}}, {{seconds}}-second rate window, ending {{time}}',
          {
            namespace: snapshot.query.namespace,
            cluster: snapshot.query.telemetryCluster,
            reporter: snapshot.query.reporter,
            seconds: snapshot.query.windowSeconds,
            time: new Date(snapshot.query.end * 1000).toISOString(),
          }
        )}
      </Typography>
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
        <TextField
          select
          label={t('Graph projection')}
          value={mode}
          onChange={event => {
            const value = event.target.value;
            if (
              value === 'workload' ||
              value === 'app' ||
              value === 'versionedApp' ||
              value === 'service'
            ) {
              setMode(value);
              setSelection(undefined);
            }
          }}
        >
          <MenuItem value="workload">{t('Workloads')}</MenuItem>
          <MenuItem value="app">{t('Applications')}</MenuItem>
          <MenuItem value="versionedApp">{t('Versioned applications')}</MenuItem>
          <MenuItem value="service">{t('Services')}</MenuItem>
        </TextField>
        <TextField
          label={t('Filter nodes and their neighbors')}
          value={search}
          inputProps={{ maxLength: 256 }}
          onChange={event => {
            setSearch(event.target.value);
            setSelection(undefined);
          }}
        />
      </Stack>
      {projected.error && <Alert severity="error">{projected.error}</Alert>}
      {graph && (
        <>
          {snapshot.query.includeIdle && (
            <Alert severity="info">
              {t(
                'Zero-rate observations are retained as dashed edges. They do not prove current activity, availability or health.'
              )}
            </Alert>
          )}
          {graph.warnings.length > 0 && (
            <Alert severity="warning">
              {t('These observations have limitations; missing data is not healthy or secure.')}{' '}
              {graph.warnings.map(warning => (
                <Warning key={JSON.stringify(warning)} warning={warning} />
              ))}
            </Alert>
          )}
          <Typography>
            {t(
              'Showing {{nodes}} of {{allNodes}} nodes and {{edges}} of {{allEdges}} connections',
              {
                nodes: graph.nodes.length,
                allNodes: projected.graph!.nodes.length,
                edges: graph.edges.length,
                allEdges: projected.graph!.edges.length,
              }
            )}
          </Typography>
          <SectionBox title={t('Observed traffic graph')}>
            <Alert severity="info">
              {t(
                'Namespace annotations compare reported namespace names with the captured graph selection. The same namespace name in another metric cluster still matches this name-based check. They do not establish Kubernetes access, mesh membership, current resource existence or health.'
              )}
            </Alert>
            <TrafficDiagram
              graph={{
                ...graph,
                nodes: graph.nodes.map(node => ({ ...node, caption: namespaceCaption(node) })),
              }}
              unit={unit}
              selection={{
                id: node?.id,
                onChange: id => setSelection(id ? { kind: 'node', id } : undefined),
              }}
            />
          </SectionBox>
          <SectionBox title={t('Observed graph nodes')}>
            <SimpleTable
              data={graph.nodes}
              columns={[
                {
                  label: t('Cluster / namespace / node'),
                  getter: (node: TopologyNode) => name(node),
                },
                {
                  label: t('Node type'),
                  getter: (node: TopologyNode) =>
                    node.kind === 'app'
                      ? t('Application')
                      : node.kind === 'service'
                      ? t('Service')
                      : node.kind === 'workload'
                      ? t('Workload')
                      : t('Unknown'),
                },
                {
                  label: t('Namespace selection'),
                  getter: (node: TopologyNode) => namespaceCaption(node),
                },
                {
                  label: t('Inspect'),
                  getter: (node: TopologyNode) => (
                    <Button
                      aria-label={t('Inspect node {{name}}', { name: name(node) })}
                      onClick={() => setSelection({ kind: 'node', id: node.id })}
                    >
                      {t('Inspect')}
                    </Button>
                  ),
                },
              ]}
            />
          </SectionBox>
          <SectionBox title={t('Observed graph connections')}>
            <SimpleTable
              data={graph.edges}
              columns={[
                { label: t('Source'), getter: (edge: TopologyEdge) => nodeNames.get(edge.source) },
                {
                  label: t('Destination'),
                  getter: (edge: TopologyEdge) => nodeNames.get(edge.target),
                },
                { label: t('Protocol'), getter: (edge: TopologyEdge) => edge.protocol },
                { label: unit, getter: (edge: TopologyEdge) => edge.rate.toPrecision(5) },
                {
                  label: t('Attribution'),
                  getter: (edge: TopologyEdge) =>
                    edge.inferred ? t('Derived through workload') : t('Reported endpoint traffic'),
                },
                {
                  label: t('Inspect'),
                  getter: (edge: TopologyEdge) => (
                    <Button
                      aria-label={t(
                        'Inspect {{protocol}} connection from {{source}} to {{target}}',
                        {
                          protocol: edge.protocol,
                          source: nodeNames.get(edge.source),
                          target: nodeNames.get(edge.target),
                        }
                      )}
                      onClick={() => setSelection({ kind: 'edge', id: edge.id })}
                    >
                      {t('Inspect')}
                    </Button>
                  ),
                },
              ]}
            />
          </SectionBox>
          {node && (
            <SectionBox title={t('Selected graph node')}>
              <Typography>{name(node)}</Typography>
              <Typography>{namespaceCaption(node)}</Typography>
              <Typography>
                {t('Reported workloads: {{values}}', {
                  values: node.workloads.join(', ') || t('Not reported'),
                })}
              </Typography>
              <Typography>
                {t('Reported canonical applications: {{values}}', {
                  values: node.apps.join(', ') || t('Not reported'),
                })}
              </Typography>
              <Typography>
                {t('Reported revisions: {{values}}', {
                  values: node.versions.join(', ') || t('Not reported'),
                })}
              </Typography>
              <Alert severity="info">
                {t(
                  'Metric identities are not verified Kubernetes objects. No resource link or health status is inferred from these labels.'
                )}
              </Alert>
              {cluster && (
                <GraphResources
                  key={node.id}
                  node={node}
                  cluster={cluster}
                  telemetryCluster={snapshot.query.telemetryCluster}
                />
              )}
              <Button onClick={() => setSelection(undefined)}>{t('Close node inspection')}</Button>
            </SectionBox>
          )}
          {edge && (
            <SectionBox title={t('Selected graph connection')}>
              <Typography>
                {nodeNames.get(edge.source)} {'->'} {nodeNames.get(edge.target)} ({edge.protocol})
              </Typography>
              <Typography>
                {edge.rate.toPrecision(5)} {unit}
              </Typography>
              <Typography>
                {t('Destination hosts: {{values}}', { values: edge.hosts.join(', ') })}
              </Typography>
              <Typography>
                {t('Metric sources: {{values}}', { values: edge.metrics.join(', ') })}
              </Typography>
              <Alert severity="info">
                {t(
                  'Response codes and flags are observations, not the configurable health calculation. Reported security policy is not proof of enforcement.'
                )}
              </Alert>
              <Distribution
                title={t('Response codes or gRPC statuses')}
                rates={edge.responses}
                unit={unit}
              />
              <Distribution title={t('Response flags')} rates={edge.flags} unit={unit} />
              <Distribution
                title={t('Reported connection security')}
                rates={edge.security}
                unit={unit}
              />
              <Button onClick={() => setSelection(undefined)}>
                {t('Close connection inspection')}
              </Button>
            </SectionBox>
          )}
        </>
      )}
    </Stack>
  );
}

function Results({
  cluster,
  endpoint,
  query,
}: {
  cluster: string;
  endpoint: ServiceEndpoint;
  query: TopologyQuery;
}) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) => loadTopology(clusterScope(cluster), endpoint, query, signal),
    [cluster, endpoint, query]
  );
  const result = useRequest(JSON.stringify([cluster, endpoint, query]), load);
  return (
    <RequestStatus state={result} loadingLabel={t('Loading traffic graph...')}>
      {snapshot => (
        <TopologyResults
          key={JSON.stringify([cluster, endpoint, query])}
          snapshot={snapshot}
          cluster={cluster}
        />
      )}
    </RequestStatus>
  );
}

export function TopologyScope({ cluster }: { cluster: string }) {
  const { t } = useTranslation();
  const config = useKialiConfig();
  const location = useLocation();
  const [namespace, setNamespace] = useState(
    new URLSearchParams(location.search).get('namespace') ?? ''
  );
  const [reporter, setReporter] = useState<TopologyQuery['reporter']>('source');
  const [windowSeconds, setWindow] = useState<TopologyQuery['windowSeconds']>(600);
  const [measure, setMeasure] = useState<TopologyQuery['measure']>('requests');
  const [includeIdle, setIdle] = useState(false);
  const [current, setCurrent] = useState(true);
  const [end, setEnd] = useState('');
  const [error, setError] = useState('');
  const settings = config.valid ? getClusterConfig(config.config, cluster) : undefined;
  const endpoint = settings?.prometheus ?? null;
  const {
    identity: metricCluster,
    setIdentity: setMetricCluster,
    query,
    setQuery,
    capturedSettings,
  } = useTelemetryQuery<TopologyQuery>(
    JSON.stringify([cluster, endpoint, settings?.telemetryCluster]),
    settings
  );
  return (
    <Stack spacing={2}>
      <SectionBox title={t('Traffic graph')} headerProps={{ headerStyle: 'main' }}>
        <Stack spacing={2}>
          <Alert severity="info">
            {t(
              'Choose the exact Istio metric cluster label, not a Headlamp context name. This snapshot uses one reporter and includes traffic touching the reported workload or destination Service namespace. Missing source/destination reports, unserviced ingress and ambient waypoint deduplication are not reconstructed.'
            )}
          </Alert>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <TextField
              label={t('Namespace')}
              value={namespace}
              onChange={event => {
                setNamespace(event.target.value);
                setQuery(undefined);
              }}
            />
            <TextField
              label={t('Istio metric cluster label')}
              value={metricCluster}
              helperText={t(
                'Uses the saved explicit identity when available. Editing this form does not change settings. Endpoint or saved-identity changes clear submitted queries.'
              )}
              onChange={event => {
                setMetricCluster(event.target.value);
                setQuery(undefined);
              }}
            />
            <TextField
              select
              label={t('Telemetry reporter')}
              value={reporter}
              onChange={event => {
                const value = event.target.value;
                if (value === 'source' || value === 'destination') {
                  setReporter(value);
                  setQuery(undefined);
                }
              }}
            >
              <MenuItem value="source">{t('Source')}</MenuItem>
              <MenuItem value="destination">{t('Destination')}</MenuItem>
            </TextField>
            <TextField
              select
              label={t('Rate window')}
              value={windowSeconds}
              onChange={event => {
                const value = Number(event.target.value);
                if (
                  value === 60 ||
                  value === 300 ||
                  value === 600 ||
                  value === 900 ||
                  value === 3600
                ) {
                  setWindow(value);
                  setQuery(undefined);
                }
              }}
            >
              {[60, 300, 600, 900, 3600].map(seconds => (
                <MenuItem key={seconds} value={seconds}>
                  {t('{{count}} minutes', { count: seconds / 60 })}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label={t('Traffic measure')}
              value={measure}
              onChange={event => {
                const value = event.target.value;
                if (
                  value === 'requests' ||
                  value === 'tcpSent' ||
                  value === 'tcpReceived' ||
                  value === 'tcpTotal' ||
                  value === 'grpcSent' ||
                  value === 'grpcReceived' ||
                  value === 'grpcTotal'
                ) {
                  setMeasure(value);
                  setQuery(undefined);
                }
              }}
            >
              <MenuItem value="requests">{t('HTTP / gRPC requests')}</MenuItem>
              <MenuItem value="tcpSent">{t('TCP sent bytes')}</MenuItem>
              <MenuItem value="tcpReceived">{t('TCP received bytes')}</MenuItem>
              <MenuItem value="tcpTotal">{t('TCP sent + received bytes')}</MenuItem>
              <MenuItem value="grpcSent">{t('gRPC sent messages')}</MenuItem>
              <MenuItem value="grpcReceived">{t('gRPC received messages')}</MenuItem>
              <MenuItem value="grpcTotal">{t('gRPC sent + received messages')}</MenuItem>
            </TextField>
          </Stack>
          <FormControlLabel
            label={t('Include zero-rate observations')}
            control={
              <Checkbox
                checked={includeIdle}
                onChange={event => {
                  setIdle(event.target.checked);
                  setQuery(undefined);
                }}
              />
            }
          />
          <FormControlLabel
            label={t('Use current time')}
            control={
              <Checkbox
                checked={current}
                onChange={event => {
                  setCurrent(event.target.checked);
                  setQuery(undefined);
                }}
              />
            }
          />
          {!current && (
            <TextField
              type="datetime-local"
              label={t('Query end time (local time)')}
              InputLabelProps={{ shrink: true }}
              value={end}
              onChange={event => {
                setEnd(event.target.value);
                setQuery(undefined);
              }}
            />
          )}
          <Button
            variant="contained"
            sx={{ alignSelf: 'flex-start' }}
            disabled={!endpoint}
            onClick={() => {
              try {
                const captured = current
                  ? Math.floor(Date.now() / 1000)
                  : Math.floor(new Date(end).getTime() / 1000);
                if (captured > Math.floor(Date.now() / 1000))
                  throw new Error(t('Choose a query end time that is not in the future'));
                const next: TopologyQuery = {
                  namespace,
                  telemetryCluster: metricCluster,
                  reporter,
                  windowSeconds,
                  measure,
                  end: captured,
                  includeIdle,
                };
                topologyQueries(next);
                setQuery(next);
                setError('');
              } catch (error) {
                setQuery(undefined);
                setError(error instanceof Error ? error.message : t('Invalid query'));
              }
            }}
          >
            {t('Load graph snapshot')}
          </Button>
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
        </Stack>
      </SectionBox>
      {capturedSettings?.prometheus && query && (
        <Results cluster={cluster} endpoint={capturedSettings.prometheus} query={query} />
      )}
    </Stack>
  );
}

export default function Topology() {
  return (
    <ClusterScope>
      {scope => <TopologyScope key={scope.cluster} cluster={scope.cluster} />}
    </ClusterScope>
  );
}
