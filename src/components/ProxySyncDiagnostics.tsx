import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback, useState } from 'react';
import { DiagnosticPod } from '../core/diagnostics';
import { ProxySyncRecord } from '../core/proxySync';
import { clusterScope } from '../core/scope';
import { loadProxySyncSnapshot } from '../data/proxySync';
import { useRequest } from '../hooks/useRequest';
import RequestStatus from './RequestStatus';

function SyncSnapshot({
  cluster,
  pod,
  attempt,
}: {
  cluster: string;
  pod: DiagnosticPod;
  attempt: number;
}) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) => loadProxySyncSnapshot(clusterScope(cluster), pod, signal),
    [cluster, pod]
  );
  const request = useRequest(
    JSON.stringify([
      cluster,
      pod.namespace,
      pod.name,
      pod.uid,
      pod.containers.find(container => container.name === 'discovery')?.restarts,
      attempt,
    ]),
    load
  );
  return (
    <RequestStatus state={request} loadingLabel={t('Reading control-plane synchronization...')}>
      {snapshot => {
        const rows = snapshot.records.flatMap((record: ProxySyncRecord) =>
          record.resources.map(resource => ({
            ...resource,
            proxy: record.proxy,
            clusterId: record.clusterId,
            istioVersion: record.istioVersion,
          }))
        );
        return (
          <Stack spacing={2}>
            <Typography>
              {t('Control-plane source')}: {snapshot.target.namespace}/{snapshot.target.pod} (
              {snapshot.target.container}, port {snapshot.target.port}) · UID {snapshot.target.uid}
              · {t('restart count')} {snapshot.target.restarts} ·{' '}
              {new Date(snapshot.capturedAt).toLocaleString()}
            </Typography>
            <Alert severity="info">
              {t(
                'Each status is reported directly by this control-plane endpoint. Proxy IDs are raw Istiod identities and are not matched to current Kubernetes Pods or UIDs.'
              )}
            </Alert>
            {rows.length ? (
              <SimpleTable
                data={rows}
                columns={[
                  { label: t('Reported proxy ID'), getter: item => item.proxy },
                  { label: t('Reported cluster ID'), getter: item => item.clusterId ?? t('Not reported') },
                  { label: t('Istio version'), getter: item => item.istioVersion ?? t('Not reported') },
                  { label: t('xDS resource'), getter: item => item.name },
                  { label: t('Sent version'), getter: item => item.sent ?? t('Not reported') },
                  { label: t('Acknowledged version'), getter: item => item.acked ?? t('Not reported') },
                  {
                    label: t('Reported status'),
                    getter: item =>
                      item.state === 'synced'
                        ? t('Synced')
                        : item.state === 'stale'
                        ? t('Stale')
                        : t('Not reported'),
                  },
                  { label: t('Last error'), getter: item => item.lastError || t('None reported') },
                ]}
              />
            ) : (
              <Alert severity="warning">
                {t('The endpoint returned no proxy synchronization resource records.')}
              </Alert>
            )}
          </Stack>
        );
      }}
    </RequestStatus>
  );
}

export default function ProxySyncDiagnostics({
  cluster,
  pod,
}: {
  cluster: string;
  pod: DiagnosticPod;
}) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const discovery = pod.containers.find(container => container.name === 'discovery');
  const ports = discovery?.ports?.filter(port => port.name === 'http-debug') ?? [];
  const canRead = !!discovery && discovery.restarts !== null && ports.length === 1;
  const unavailableMessage = !discovery
    ? t('Select a control-plane Pod with an observed discovery container to inspect sync status.')
    : discovery.restarts === null
    ? t('The discovery container restart count is unavailable; reload its identity before reading.')
    : ports.length !== 1
    ? t('The discovery container must declare exactly one http-debug port; no port is guessed.')
    : '';
  return (
    <SectionBox title={t('Control-plane synchronization')}>
      <Stack spacing={2}>
        <Typography>
          {t(
            'This is a read-only GET to the selected Pod’s declared http-debug port via Headlamp. It requires Kubernetes get access to pods/proxy and may still be denied by Istiod.'
          )}
        </Typography>
        <Alert severity="warning">
          {t(
            'No token, alternate endpoint, or privileged fallback is used. A denied or unsupported endpoint is a capability gap, not an unsynchronized result.'
          )}
        </Alert>
        {!canRead && <Alert severity="info">{unavailableMessage}</Alert>}
        <Button
          disabled={!canRead}
          onClick={() => setAttempt(current => current + 1)}
        >
          {t('Read control-plane synchronization')}
        </Button>
        {canRead && attempt > 0 && (
          <SyncSnapshot key={`${cluster}:${pod.uid}:${attempt}`} cluster={cluster} pod={pod} attempt={attempt} />
        )}
      </Stack>
    </SectionBox>
  );
}
