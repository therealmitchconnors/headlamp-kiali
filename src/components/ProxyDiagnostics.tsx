import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback, useState } from 'react';
import { useKialiConfig } from '../config';
import { getClusterConfig } from '../core/config';
import { DiagnosticPod } from '../core/diagnostics';
import { ProxyConfigEntry, proxyConfiguration, proxyServerInfo } from '../core/proxyConfig';
import { clusterScope } from '../core/scope';
import { ztunnelSnapshot } from '../core/ztunnel';
import { loadProxySnapshot, ProxyRead } from '../data/proxyAdmin';
import { useRequest } from '../hooks/useRequest';
import CodeBlock from './configuration/CodeBlock';
import ProxyEntryDetails from './ProxyEntryDetails';
import RequestStatus from './RequestStatus';
import ZtunnelDiagnostics from './ZtunnelDiagnostics';

function Snapshot({
  cluster,
  pod,
  read,
  domain,
}: {
  cluster: string;
  pod: DiagnosticPod;
  read: ProxyRead;
  domain: string | null;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<ProxyConfigEntry>();
  const load = useCallback(
    async (signal: AbortSignal) => {
      const snapshot = await loadProxySnapshot(clusterScope(cluster), pod, read, signal);
      return {
        capturedAt: snapshot.capturedAt,
        restartVerified: snapshot.restartVerified,
        info: read === 'server-info' ? proxyServerInfo(snapshot.data) : undefined,
        config: read === 'configuration' ? proxyConfiguration(snapshot.data) : undefined,
        ztunnel: read === 'ztunnel-configuration' ? ztunnelSnapshot(snapshot.data) : undefined,
      };
    },
    [cluster, pod, read]
  );
  const result = useRequest(JSON.stringify([cluster, pod.uid, read]), load);
  const states: Record<ProxyConfigEntry['state'], string> = {
    static: t('Static'),
    active: t('Active'),
    warming: t('Warming'),
    draining: t('Draining'),
    dynamic: t('Dynamic'),
    unavailable: t('No configuration state reported'),
  };
  const kinds: Record<ProxyConfigEntry['kind'], string> = {
    cluster: t('Cluster'),
    route: t('Route'),
    listener: t('Listener'),
  };
  const entryName = (entry: ProxyConfigEntry) =>
    entry.name === null ? t('Not reported') : entry.name || t('Empty name');
  return (
    <RequestStatus state={result} loadingLabel={t('Reading bounded proxy diagnostics...')}>
      {snapshot => (
        <Stack spacing={2}>
          <Typography>{new Date(snapshot.capturedAt).toLocaleString()}</Typography>
          <Alert severity="info">
            {t(
              'This is observed proxy state, not a control-plane synchronization, configuration validity or mesh-health verdict.'
            )}
          </Alert>
          {!snapshot.restartVerified && (
            <Alert severity="warning">
              {t(
                'Proxy restart count was not reported; the exact proxy instance could not be verified.'
              )}
            </Alert>
          )}
          {snapshot.ztunnel && <ZtunnelDiagnostics data={snapshot.ztunnel} />}
          {snapshot.info && (
            <SimpleTable
              data={[
                { label: t('Envoy version'), value: snapshot.info.version },
                { label: t('Server state'), value: snapshot.info.state },
                { label: t('Current epoch uptime'), value: snapshot.info.uptime },
                { label: t('All epochs uptime'), value: snapshot.info.originalUptime },
              ]}
              columns={[
                { label: t('Field'), getter: item => item.label },
                { label: t('Value'), getter: item => item.value ?? t('Not reported') },
              ]}
            />
          )}
          {snapshot.config && (
            <>
              <Typography>
                {t('Configuration section types')}:{' '}
                {snapshot.config.sections.join(', ') || t('None returned')}
              </Typography>
              <Typography>
                {t('Cluster, route and listener entries')}: {snapshot.config.entries.length}
              </Typography>
              <SimpleTable
                data={snapshot.config.entries}
                columns={[
                  { label: t('Entry'), getter: item => item.index },
                  { label: t('Type'), getter: item => kinds[item.kind] },
                  { label: t('Name'), getter: entryName },
                  { label: t('State'), getter: item => states[item.state] },
                  { label: t('Version'), getter: item => item.version ?? t('Not reported') },
                  { label: t('Last updated'), getter: item => item.updated ?? t('Not reported') },
                  {
                    label: t('Details'),
                    getter: item => (
                      <Button
                        aria-label={t('Inspect {{kind}} {{name}} ({{state}}), entry {{index}}', {
                          kind: kinds[item.kind],
                          name: entryName(item),
                          state: states[item.state],
                          index: item.index,
                        })}
                        onClick={() => setSelected(item)}
                      >
                        {t('Inspect')}
                      </Button>
                    ),
                  },
                ]}
              />
              {selected && (
                <>
                  <Button onClick={() => setSelected(undefined)}>{t('Hide proxy entry')}</Button>
                  <ProxyEntryDetails
                    key={selected.index}
                    entry={selected}
                    domain={domain}
                    cluster={cluster}
                  />
                  <CodeBlock
                    value={JSON.stringify(selected.raw, null, 2)}
                    label={t('Selected proxy configuration entry')}
                  />
                </>
              )}
            </>
          )}
        </Stack>
      )}
    </RequestStatus>
  );
}

export default function ProxyDiagnostics({
  cluster,
  pod,
}: {
  cluster: string;
  pod: DiagnosticPod;
}) {
  const { t } = useTranslation();
  const config = useKialiConfig();
  const domain =
    config.valid === true ? getClusterConfig(config.config, cluster).identityDomain ?? null : null;
  const [request, setRequest] = useState<{ read: ProxyRead; attempt: number }>();
  const [format, setFormat] = useState<'envoy' | 'ztunnel'>(() =>
    pod.containers.some(container => container.name === 'ztunnel') &&
    !pod.containers.some(container => container.name === 'istio-proxy')
      ? 'ztunnel'
      : 'envoy'
  );
  const selectFormat = (value: 'envoy' | 'ztunnel') => {
    setFormat(value);
    setRequest(undefined);
  };
  return (
    <SectionBox title={t('Read-only proxy diagnostics')}>
      <Stack spacing={2}>
        {config.valid === false && <Alert severity="error">{config.message}</Alert>}
        <Typography>
          {t(
            'Read proxy data through one Kubernetes forwarding stream to port 15000. No local listener, command execution or log-level change is used. Reads require pod port-forward permission and expire after 15 seconds.'
          )}
        </Typography>
        <Alert severity="warning">
          {t(
            'Configuration can contain sensitive workload information. It is not saved in plugin settings. Server information is bounded to 256 KiB and configuration to 4 MiB.'
          )}{' '}
          {format === 'envoy'
            ? t('Envoy bootstrap, secrets and endpoint details are not displayed.')
            : t('Top-level ztunnel certificate material and policy bodies are not displayed.')}
        </Alert>
        <Typography>
          {t(
            'Choose the diagnostic format explicitly. The selection does not detect ambient enrollment or install a proxy.'
          )}
        </Typography>
        <RadioGroup row aria-label={t('Proxy diagnostic format')} value={format}>
          <FormControlLabel
            value="envoy"
            label={t('Envoy')}
            control={<Radio onChange={() => selectFormat('envoy')} />}
          />
          <FormControlLabel
            value="ztunnel"
            label={t('ztunnel')}
            control={<Radio onChange={() => selectFormat('ztunnel')} />}
          />
        </RadioGroup>
        <Stack direction="row" spacing={2}>
          {format === 'envoy' && (
            <Button
              onClick={() =>
                setRequest(current => ({
                  read: 'server-info',
                  attempt: (current?.attempt ?? 0) + 1,
                }))
              }
            >
              {t('Read proxy server information')}
            </Button>
          )}
          <Button
            onClick={() =>
              setRequest(current => ({
                read: format === 'ztunnel' ? 'ztunnel-configuration' : 'configuration',
                attempt: (current?.attempt ?? 0) + 1,
              }))
            }
          >
            {format === 'ztunnel' ? t('Read ztunnel configuration') : t('Read proxy configuration')}
          </Button>
        </Stack>
        {request && (
          <Snapshot
            key={JSON.stringify([cluster, pod.uid, request.read, request.attempt])}
            cluster={cluster}
            pod={pod}
            read={request.read}
            domain={domain}
          />
        )}
      </Stack>
    </SectionBox>
  );
}
