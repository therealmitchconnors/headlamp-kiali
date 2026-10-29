import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { DiagnosticPod, podLogPath, PodLogQuery } from '../core/diagnostics';
import { isDnsLabel, isDnsSubdomain } from '../core/object';
import { clusterScope } from '../core/scope';
import { loadDiagnosticPod, loadPodLogSnapshot } from '../data/diagnostics';
import { useRequest } from '../hooks/useRequest';
import ClusterScope from './ClusterScope';
import CodeBlock from './configuration/CodeBlock';
import ProxyDiagnostics from './ProxyDiagnostics';
import RequestStatus from './RequestStatus';

function Logs({ cluster, query }: { cluster: string; query: PodLogQuery }) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) => loadPodLogSnapshot(clusterScope(cluster), query, signal),
    [cluster, query]
  );
  const result = useRequest(JSON.stringify([cluster, query]), load);
  return (
    <RequestStatus state={result} loadingLabel={t('Reading bounded container logs...')}>
      {snapshot => (
        <SectionBox title={t('Container log snapshot')}>
          <Stack spacing={2}>
            <Typography>
              {query.namespace}/{query.pod}: {query.container} -{' '}
              {new Date(snapshot.capturedAt).toLocaleString()}
            </Typography>
            <Alert severity="info">
              {t(
                'This is a bounded snapshot, not complete history or a health verdict. Logs may contain sensitive application data; they are not saved in plugin settings.'
              )}
            </Alert>
            {snapshot.limited && (
              <Alert severity="warning">
                {t('The 256 KiB log limit was reached; output may be truncated.')}
              </Alert>
            )}
            {snapshot.container.restarts === null && (
              <Alert severity="warning">
                {t(
                  'Container restart state is not reported; the exact container instance could not be verified.'
                )}
              </Alert>
            )}
            {snapshot.text ? (
              <CodeBlock value={snapshot.text} label={t('Container log snapshot')} />
            ) : (
              <Alert severity="info">
                {t('No log text was returned for the selected container and time window.')}
              </Alert>
            )}
          </Stack>
        </SectionBox>
      )}
    </RequestStatus>
  );
}
function PodDiagnostics({ cluster, pod }: { cluster: string; pod: DiagnosticPod }) {
  const { t } = useTranslation();
  const [container, setContainer] = useState(
    pod.containers.find(item => item.name === 'istio-proxy')?.name ?? pod.containers[0]?.name ?? ''
  );
  const [tailLines, setTailLines] = useState(200);
  const [sinceSeconds, setSinceSeconds] = useState(900);
  const [previous, setPrevious] = useState(false);
  const [query, setQuery] = useState<PodLogQuery>();
  const [error, setError] = useState('');
  return (
    <>
      <SectionBox title={t('Observed containers')}>
        <Stack spacing={2}>
          <SimpleTable
            data={pod.containers}
            columns={[
              { label: t('Container'), getter: item => item.name },
              {
                label: t('Type'),
                getter: item =>
                  item.nativeSidecar
                    ? t('Native sidecar')
                    : item.type === 'init'
                    ? t('Init container')
                    : item.type === 'ephemeral'
                    ? t('Ephemeral container')
                    : t('Regular container'),
              },
              {
                label: t('Ready'),
                getter: item =>
                  item.ready === null ? t('Not reported') : item.ready ? t('True') : t('False'),
              },
              { label: t('Restarts'), getter: item => item.restarts ?? t('Not reported') },
            ]}
          />
          <Link
            routeName="Pod"
            activeCluster={cluster}
            params={{ namespace: pod.namespace, name: pod.name }}
          >
            {t('Open native Pod details')}
          </Link>
          <Typography variant="body2">
            {t(
              'Use native Pod details for Headlamp live-log controls. No commands or log-level changes are executed.'
            )}
          </Typography>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <TextField
              select
              label={t('Log container')}
              sx={{ minWidth: 180 }}
              value={container}
              onChange={event => {
                setContainer(event.target.value);
                setQuery(undefined);
              }}
            >
              {pod.containers.map(item => (
                <MenuItem key={item.name} value={item.name}>
                  {item.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label={t('Log line limit')}
              sx={{ minWidth: 160 }}
              value={tailLines}
              onChange={event => {
                setTailLines(Number(event.target.value));
                setQuery(undefined);
              }}
            >
              {[50, 200, 1000].map(value => (
                <MenuItem key={value} value={value}>
                  {value}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label={t('Log lookback (minutes)')}
              sx={{ minWidth: 220 }}
              value={sinceSeconds}
              onChange={event => {
                setSinceSeconds(Number(event.target.value));
                setQuery(undefined);
              }}
            >
              {[5, 15, 60, 1440].map(value => (
                <MenuItem key={value} value={value * 60}>
                  {value}
                </MenuItem>
              ))}
            </TextField>
            <FormControlLabel
              label={t('Previous container instance')}
              control={
                <Switch
                  checked={previous}
                  onChange={event => {
                    setPrevious(event.target.checked);
                    setQuery(undefined);
                  }}
                />
              }
            />
            <Button
              variant="contained"
              onClick={() => {
                try {
                  const next = {
                    namespace: pod.namespace,
                    pod: pod.name,
                    uid: pod.uid,
                    container,
                    tailLines,
                    previous,
                    sinceSeconds,
                  };
                  podLogPath(next);
                  setQuery(next);
                  setError('');
                } catch (error) {
                  setError(
                    error instanceof Error ? error.message : t('Invalid diagnostic request')
                  );
                }
              }}
            >
              {t('Read log snapshot')}
            </Button>
          </Stack>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </SectionBox>
      {query && <Logs cluster={cluster} query={query} />}
      {pod.containers.some(container => ['istio-proxy', 'ztunnel'].includes(container.name)) && (
        <ProxyDiagnostics cluster={cluster} pod={pod} />
      )}
    </>
  );
}
function PodRead({
  cluster,
  namespace,
  name,
  attempt,
}: {
  cluster: string;
  namespace: string;
  name: string;
  attempt: number;
}) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) => loadDiagnosticPod(clusterScope(cluster), namespace, name, signal),
    [cluster, namespace, name]
  );
  const result = useRequest(JSON.stringify([cluster, namespace, name, attempt]), load);
  return (
    <RequestStatus state={result} loadingLabel={t('Loading pod diagnostic identity...')}>
      {pod => <PodDiagnostics key={pod.uid} cluster={cluster} pod={pod} />}
    </RequestStatus>
  );
}
function DiagnosticScope({ cluster }: { cluster: string }) {
  const { t } = useTranslation();
  const params = new URLSearchParams(useLocation().search);
  const [namespace, setNamespace] = useState(params.get('namespace') ?? '');
  const [name, setName] = useState(params.get('pod') ?? '');
  const [selection, setSelection] = useState<{
    namespace: string;
    name: string;
    attempt: number;
  }>();
  const [error, setError] = useState('');
  return (
    <>
      <SectionBox title={t('Pod diagnostics')} headerProps={{ headerStyle: 'main' }}>
        <Stack spacing={2}>
          <Typography>
            {t(
              'Read container inventory and bounded current/previous logs through Headlamp. Native sidecars and init/ephemeral containers are included; no cluster component is installed.'
            )}
          </Typography>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <TextField
              label={t('Namespace')}
              value={namespace}
              onChange={event => {
                setNamespace(event.target.value);
                setSelection(undefined);
              }}
            />
            <TextField
              label={t('Pod name')}
              sx={{ minWidth: 280, flexGrow: 1, maxWidth: 560 }}
              value={name}
              onChange={event => {
                setName(event.target.value);
                setSelection(undefined);
              }}
            />
            <Button
              variant="contained"
              onClick={() => {
                if (!isDnsLabel(namespace) || !isDnsSubdomain(name)) {
                  setError(t('Enter a valid namespace and Pod name'));
                  return;
                }
                setError('');
                setSelection(current => ({
                  namespace,
                  name,
                  attempt: (current?.attempt ?? 0) + 1,
                }));
              }}
            >
              {t('Load pod')}
            </Button>
          </Stack>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </SectionBox>
      {selection && <PodRead cluster={cluster} {...selection} />}
    </>
  );
}
export default function Diagnostics() {
  return (
    <ClusterScope>
      {scope => <DiagnosticScope key={scope.cluster} cluster={scope.cluster} />}
    </ClusterScope>
  );
}
