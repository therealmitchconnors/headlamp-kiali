import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Link, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ProxyConfigurationKind,
  ProxyConfigurationQuery,
  proxyConfigurationTarget,
} from '../core/proxyConfigurationReference';
import { ClusterScope, clusterScope } from '../core/scope';
import { loadProxyConfigurationCandidate } from '../data/proxyConfigurationReference';
import { useRequest } from '../hooks/useRequest';
import RequestStatus from './RequestStatus';

interface Request {
  scope: ClusterScope;
  query: ProxyConfigurationQuery;
  binding: string;
  attempt: number;
}
function CurrentConfiguration({ request }: { request: Request }) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) => loadProxyConfigurationCandidate(request.scope, request.query, signal),
    [request]
  );
  const state = useRequest(JSON.stringify(request), load);
  return (
    <RequestStatus
      state={state}
      loadingLabel={t('Looking up the current configuration candidate...')}
    >
      {data => (
        <Stack spacing={1}>
          <Typography>
            {t('Current {{kind}} candidate', { kind: data.kind })}:{' '}
            <Link
              routeName={data.routeName}
              params={{ cluster: data.cluster, namespace: data.namespace, name: data.name }}
            >
              {data.namespace}/{data.name}
            </Link>
          </Typography>
          <Typography variant="body2">
            {t('Checked at {{time}} in {{cluster}}.', {
              time: new Date(data.checkedAt).toLocaleString(),
              cluster: data.cluster,
            })}
          </Typography>
          <SimpleTable
            data={[
              { field: t('Observed configuration UID'), value: data.uid },
              { field: t('Resource version'), value: data.resourceVersion },
              { field: t('Metadata reference API version'), value: data.observedApiVersion },
              { field: t('Current served API version'), value: data.apiVersion },
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

export default function ProxyConfigurationCandidate({
  cluster,
  kind,
  path,
}: {
  cluster: string;
  kind: ProxyConfigurationKind;
  path: string;
}) {
  const { t } = useTranslation();
  const [request, setRequest] = useState<Request>();
  const [error, setError] = useState('');
  const binding = JSON.stringify([cluster, kind, path]);
  useEffect(() => {
    setRequest(undefined);
    setError('');
  }, [binding]);
  const candidate = useMemo(() => {
    try {
      return proxyConfigurationTarget({ kind, path });
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Invalid configuration reference' };
    }
  }, [kind, path]);
  const reasons = {
    absent: t('No configuration metadata reference was reported.'),
    format: t('This metadata reference is not a canonical networking.istio.io/v1 resource path.'),
    kind: t('The metadata resource type does not match the expected configuration kind.'),
    identity: t('The metadata namespace or resource name is not a valid Kubernetes identity.'),
  };
  if ('error' in candidate)
    return (
      <Alert severity="warning">{candidate.error || t('Invalid configuration reference')}</Alert>
    );
  if (candidate.available === false)
    return <Typography variant="body2">{reasons[candidate.reason]}</Typography>;
  return (
    <Stack spacing={1}>
      <Typography variant="h6" component="h3">
        {t('Current configuration lookup')}
      </Typography>
      <Typography>
        {t('Look in {{cluster}} for {{kind}} {{namespace}}/{{name}}.', {
          cluster,
          kind,
          namespace: candidate.namespace,
          name: candidate.name,
        })}
      </Typography>
      <Box component="code" sx={{ overflowWrap: 'anywhere' }}>
        {path}
      </Box>
      <Alert severity="info">
        {t(
          'Envoy metadata contains a name reference, not a Kubernetes UID or resource version. A current object match does not prove which historical object produced this snapshot, that the proxy accepted the current specification, or that its policy is valid. Navigation uses namespace and name rather than a permanent UID binding.'
        )}
      </Alert>
      <Button
        onClick={() => {
          try {
            const scope = clusterScope(cluster);
            setRequest(current => ({
              scope,
              query: { kind, path },
              binding,
              attempt: (current?.attempt ?? 0) + 1,
            }));
            setError('');
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : t('Unable to capture configuration lookup scope')
            );
          }
        }}
      >
        {t('Find current {{kind}} candidate', { kind })}
      </Button>
      <Typography variant="body2">
        {t(
          'The lookup discovers a supported current API version and stops after 15 seconds. Changing the entry or cluster discards the result without replay.'
        )}
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {request?.binding === binding && <CurrentConfiguration request={request} />}
    </Stack>
  );
}
