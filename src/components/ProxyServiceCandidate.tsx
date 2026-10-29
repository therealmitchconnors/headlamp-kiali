import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { proxyServiceCandidate, ProxyServiceQuery } from '../core/proxyService';
import { ClusterScope, clusterScope } from '../core/scope';
import { loadProxyServiceCandidate } from '../data/proxyService';
import { useRequest } from '../hooks/useRequest';
import CorrelatedResourceName from './CorrelatedResourceName';
import RequestStatus from './RequestStatus';

interface Request {
  scope: ClusterScope;
  query: ProxyServiceQuery;
  binding: string;
  attempt: number;
}
function CurrentService({ request }: { request: Request }) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) => loadProxyServiceCandidate(request.scope, request.query, signal),
    [request]
  );
  const state = useRequest(JSON.stringify(request), load);
  const text = (value: string | undefined) =>
    value === undefined ? t('Not reported') : value === '' ? t('Empty') : value;
  return (
    <RequestStatus state={state} loadingLabel={t('Looking up the current Service candidate...')}>
      {data => (
        <Stack spacing={1}>
          <Typography>
            {t('Current Service candidate')}: <CorrelatedResourceName resource={data} />
          </Typography>
          <Typography variant="body2">
            {t('Checked at {{time}} in {{cluster}}/{{namespace}}.', {
              time: new Date(data.checkedAt).toLocaleString(),
              cluster: data.scope.cluster,
              namespace: data.scope.namespace,
            })}
          </Typography>
          <SimpleTable
            data={[
              { field: t('Observed Service UID'), value: data.identity.uid },
              { field: t('Resource version'), value: data.resourceVersion },
              { field: t('Service type'), value: text(data.serviceType) },
              { field: t('External name'), value: text(data.externalName) },
            ]}
            columns={[
              { label: t('Field'), getter: item => item.field },
              {
                label: t('Value'),
                getter: item => <Box sx={{ overflowWrap: 'anywhere' }}>{item.value}</Box>,
              },
            ]}
          />
          <Alert severity={data.portDeclared ? 'info' : 'warning'}>
            {data.portDeclared
              ? t('Port {{port}} is declared in the current Service specification.', {
                  port: data.target.port,
                })
              : t(
                  'Port {{port}} is not declared in the current Service specification; the name-based candidate may not match the captured proxy configuration.',
                  { port: data.target.port }
                )}
          </Alert>
          <SimpleTable
            data={data.ports}
            emptyMessage={t('No Service ports were reported.')}
            columns={[
              { label: t('Port'), getter: item => item.port },
              { label: t('Name'), getter: item => text(item.name) },
              { label: t('Protocol'), getter: item => text(item.protocol) },
            ]}
          />
        </Stack>
      )}
    </RequestStatus>
  );
}

export default function ProxyServiceCandidate({
  cluster,
  name,
  domain,
}: {
  cluster: string;
  name: string | null;
  domain: string | null;
}) {
  const { t } = useTranslation();
  const [request, setRequest] = useState<Request>();
  const [error, setError] = useState('');
  const binding = JSON.stringify([cluster, name, domain]);
  useEffect(() => {
    setRequest(undefined);
    setError('');
  }, [binding]);
  const candidate = useMemo(() => {
    try {
      return proxyServiceCandidate({ name, identityDomain: domain });
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Invalid Service candidate' };
    }
  }, [name, domain]);
  const reasons = {
    domain: t(
      'Configure an explicit Service DNS identity domain before looking up a Service candidate.'
    ),
    format: t('This cluster name is not a canonical four-part Istio outbound Service name.'),
    direction: t('Only outbound cluster names are eligible for a Service candidate lookup.'),
    host: t(
      'The cluster host is not an unambiguous Kubernetes Service FQDN in the configured DNS domain.'
    ),
    port: t('The cluster name does not report a Service port from 1 to 65535.'),
  };
  if ('error' in candidate)
    return <Alert severity="warning">{candidate.error || t('Invalid Service candidate')}</Alert>;
  if (candidate.available === false)
    return <Typography variant="body2">{reasons[candidate.reason]}</Typography>;
  const target = candidate.target;
  return (
    <Stack spacing={1}>
      <Typography variant="h6" component="h3">
        {t('Current Service lookup')}
      </Typography>
      <Typography>
        {t('Look in {{cluster}} for Service {{namespace}}/{{name}}, port {{port}}.', {
          cluster,
          namespace: target.namespace,
          name: target.name,
          port: target.port,
        })}
      </Typography>
      <Alert severity="info">
        {t(
          'An Envoy cluster name carries no Kubernetes UID. This finds a current name-based candidate, not historical identity, ownership, traffic origin or mesh membership. Port presence does not verify subsets, endpoints, protocol compatibility, routing or health. Navigation uses namespace and name rather than a permanent UID binding.'
        )}
      </Alert>
      <Button
        onClick={() => {
          try {
            const scope = clusterScope(cluster);
            setRequest(current => ({
              scope,
              query: { name, identityDomain: domain },
              binding,
              attempt: (current?.attempt ?? 0) + 1,
            }));
            setError('');
          } catch (error) {
            setError(
              error instanceof Error ? error.message : t('Unable to capture Service lookup scope')
            );
          }
        }}
      >
        {t('Find current Service candidate')}
      </Button>
      <Typography variant="body2">
        {t(
          'This explicit read stops after 15 seconds and is not replayed when the cluster, proxy entry or DNS domain changes.'
        )}
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {request?.binding === binding && <CurrentService request={request} />}
    </Stack>
  );
}
