import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback, useState } from 'react';
import { useKialiConfig } from '../config';
import { getClusterConfig, ServiceEndpoint } from '../core/config';
import { clusterScope } from '../core/scope';
import { discoverIstio, inspectPrometheus } from '../data/requests';
import { useRequest } from '../hooks/useRequest';
import ClusterScope from './ClusterScope';
import RequestStatus from './RequestStatus';

function IstioCapability({ cluster, refresh }: { cluster: string; refresh: number }) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) => discoverIstio(clusterScope(cluster), signal),
    [cluster]
  );
  const result = useRequest(JSON.stringify([cluster, refresh]), load);
  return (
    <SectionBox title={t('Istio API discovery')}>
      {result.status === 'error' && result.error.kind === 'not-found' ? (
        <Alert severity="info">
          {t('Istio networking APIs are not installed in this cluster.')}
        </Alert>
      ) : (
        <RequestStatus state={result}>
          {data => (
            <Alert severity="success">
              {t('Istio networking APIs are available: {{versions}}.', {
                versions: data.versions.join(', '),
              })}
            </Alert>
          )}
        </RequestStatus>
      )}
      <Typography variant="body2" sx={{ mt: 1 }}>
        {t(
          'API availability does not establish control-plane health or mesh configuration validity.'
        )}
      </Typography>
    </SectionBox>
  );
}

function MetricsCapability({
  cluster,
  endpoint,
  refresh,
}: {
  cluster: string;
  endpoint: ServiceEndpoint;
  refresh: number;
}) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) => inspectPrometheus(clusterScope(cluster), endpoint, signal),
    [cluster, endpoint]
  );
  const result = useRequest(JSON.stringify([cluster, endpoint, refresh]), load);
  return (
    <RequestStatus state={result}>
      {data => (
        <Alert severity="success">
          {t('Prometheus {{version}} is reachable through {{namespace}}/{{service}}:{{port}}.', {
            version: data.version,
            namespace: endpoint.namespace,
            service: endpoint.service,
            port: endpoint.port,
          })}
        </Alert>
      )}
    </RequestStatus>
  );
}

function ClusterOverview({ cluster }: { cluster: string }) {
  const { t } = useTranslation();
  const [refresh, setRefresh] = useState(0);
  const state = useKialiConfig();
  const endpoint = state.valid ? getClusterConfig(state.config, cluster).prometheus : null;
  return (
    <>
      <SectionBox title={t('Kiali overview')} headerProps={{ headerStyle: 'main' }}>
        <Stack spacing={2}>
          <Typography>{t('Cluster: {{cluster}}', { cluster })}</Typography>
          <Alert severity="info">
            {t(
              'Native resource browsing, application relationships, Istio configuration and initial traffic metrics are available. Full mesh health, validation coverage and advanced Kiali workflows remain in development.'
            )}
          </Alert>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <Link routeName="kiali-namespaces">{t('Namespaces')}</Link>
            <Link routeName="kiali-clusters">{t('Cluster comparison')}</Link>
            <Link routeName="kiali-applications">{t('Applications')}</Link>
            <Link routeName="kiali-configuration">{t('Istio configuration')}</Link>
            <Link routeName="kiali-traffic">{t('Traffic metrics')}</Link>
            <Link routeName="kiali-services">{t('Services')}</Link>
            <Link routeName="kiali-workloads">{t('Workloads')}</Link>
            <Link routeName="kiali-settings">{t('Connection settings')}</Link>
          </Stack>
          <Button
            variant="outlined"
            sx={{ alignSelf: 'flex-start' }}
            onClick={() => setRefresh(value => value + 1)}
          >
            {t('Refresh connections')}
          </Button>
        </Stack>
      </SectionBox>
      <IstioCapability cluster={cluster} refresh={refresh} />
      <SectionBox title={t('Metrics connection')}>
        {state.valid === false ? (
          <Alert severity="error">
            {t('Stored Kiali configuration is invalid: {{message}}', { message: state.message })}
          </Alert>
        ) : endpoint ? (
          <MetricsCapability cluster={cluster} endpoint={endpoint} refresh={refresh} />
        ) : (
          <Alert severity="info">
            {t(
              'No Prometheus Service is configured for this cluster. Configure an existing Service in Connection settings.'
            )}
          </Alert>
        )}
      </SectionBox>
    </>
  );
}

export default function Overview() {
  return (
    <ClusterScope>
      {scope => <ClusterOverview key={scope.cluster} cluster={scope.cluster} />}
    </ClusterScope>
  );
}
