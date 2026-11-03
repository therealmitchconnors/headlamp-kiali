import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Link, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';
import { clusterScope } from '../core/scope';
import { ZtunnelResourceCandidate } from '../core/ztunnel';
import { loadZtunnelResourceCandidate } from '../data/ztunnelResourceCandidate';
import { useRequest } from '../hooks/useRequest';
import RequestStatus from './RequestStatus';

interface Request {
  target: ZtunnelResourceCandidate;
  binding: string;
  attempt: number;
}

function CurrentCandidate({ cluster, request }: { cluster: string; request: Request }) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) =>
      loadZtunnelResourceCandidate(clusterScope(cluster), request.target, signal),
    [cluster, request]
  );
  const state = useRequest(JSON.stringify([cluster, request]), load);
  return (
    <RequestStatus
      state={state}
      loadingLabel={t('Looking up the current ztunnel resource candidate...')}
    >
      {data => (
        <Stack spacing={1}>
          <Typography>
            {t('Current {{kind}} candidate', { kind: data.kind })}:{' '}
            <Link
              routeName={data.kind}
              activeCluster={data.scope.cluster}
              params={{ namespace: data.namespace, name: data.name }}
            >
              {data.namespace}/{data.name}
            </Link>
          </Typography>
          <Typography variant="body2">
            {t('Checked at {{time}} in {{cluster}}.', {
              time: new Date(data.checkedAt).toLocaleString(),
              cluster: data.scope.cluster,
            })}
          </Typography>
          <SimpleTable
            data={[
              { field: t('Current resource UID'), value: data.uid },
              { field: t('Current resource version'), value: data.resourceVersion },
            ]}
            columns={[
              { label: t('Field'), getter: item => item.field },
              {
                label: t('Value'),
                getter: item => <Box sx={{ overflowWrap: 'anywhere' }}>{item.value}</Box>,
              },
            ]}
          />
        </Stack>
      )}
    </RequestStatus>
  );
}

export default function ZtunnelResourceCandidate({
  cluster,
  target,
  registryIdentity,
}: {
  cluster: string;
  target: ZtunnelResourceCandidate | null;
  registryIdentity: string;
}) {
  const { t } = useTranslation();
  const [request, setRequest] = useState<Request>();
  const binding = JSON.stringify([cluster, target, registryIdentity]);
  useEffect(() => setRequest(undefined), [binding]);
  if (!target) return null;
  return (
    <Stack spacing={1}>
      <Alert severity="info">
        {t(
          'The ztunnel registry identity is not a Kubernetes UID. This is a current name-based candidate check; it does not bind the historical observation to the current object or prove mesh membership, workload health or traffic.'
        )}
      </Alert>
      <Button
        onClick={() =>
          setRequest(current => ({
            target,
            binding,
            attempt: (current?.attempt ?? 0) + 1,
          }))
        }
      >
        {t('Find current {{kind}} candidate', { kind: target.kind })}
      </Button>
      <Typography variant="body2">
        {t(
          'The explicit read is scoped to the current Headlamp cluster and namespace; it is not replayed after the registry selection changes.'
        )}
      </Typography>
      {request?.binding === binding && <CurrentCandidate cluster={cluster} request={request} />}
    </Stack>
  );
}
