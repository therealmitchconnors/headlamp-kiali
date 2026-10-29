import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback } from 'react';
import { ServiceEndpoint } from '../core/config';
import { DashboardDiscoveryQuery } from '../core/dashboardDiscovery';
import { clusterScope } from '../core/scope';
import { discoverCustomDashboards } from '../data/dashboardDiscovery';
import { useRequest } from '../hooks/useRequest';
import RequestStatus from './RequestStatus';

export default function DashboardDiscovery({
  cluster,
  endpoint,
  query,
  onSelect,
}: {
  cluster: string;
  endpoint: ServiceEndpoint;
  query: DashboardDiscoveryQuery;
  onSelect: (name: string) => void;
}) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) =>
      discoverCustomDashboards(clusterScope(cluster), endpoint, query, signal),
    [cluster, endpoint, query]
  );
  const state = useRequest(JSON.stringify([cluster, endpoint, query]), load);
  return (
    <SectionBox title={t('Discovered saved dashboards')}>
      <RequestStatus state={state} loadingLabel={t('Discovering dashboard metrics...')}>
        {data => (
          <Stack spacing={2}>
            <Typography>
              {t('Discovery namespace: {{namespace}}; captured instant: {{time}}', {
                namespace: data.query.namespace,
                time: new Date(data.query.end * 1000).toISOString(),
              })}
            </Typography>
            <Typography>
              {data.query.clusterLabel
                ? t('Captured metric cluster filter: {{label}} = {{value}}', {
                    label: data.query.clusterLabel,
                    value: data.query.metricCluster,
                  })
                : t(
                    'This discovery used your explicit single-cluster-source confirmation; the plugin cannot verify that assertion.'
                  )}
            </Typography>
            <Alert severity="info">
              {t(
                'These are exact metric-name matches to saved definitions at one instant, not proof of an application runtime, Kubernetes ownership or health. Includes may still fail when loaded. Selecting a result changes only the template draft; it does not fetch chart data.'
              )}
            </Alert>
            {!!data.warnings.length && <Alert severity="warning">{data.warnings.join('; ')}</Alert>}
            {!data.runtimes.length ? (
              <Alert severity="info">
                {t(
                  'No saved dashboard templates matched the returned metric names. This is not a health or availability verdict.'
                )}
              </Alert>
            ) : (
              data.runtimes.map(runtime => (
                <SectionBox
                  key={runtime.name}
                  title={
                    runtime.name
                      ? t('Runtime label: {{runtime}}', { runtime: JSON.stringify(runtime.name) })
                      : t('Unspecified runtime')
                  }
                >
                  <SimpleTable
                    data={runtime.dashboards}
                    columns={[
                      { label: t('Template'), getter: item => item.name },
                      { label: t('Title'), getter: item => item.title || t('Title not specified') },
                      { label: t('Discovery metric'), getter: item => item.discoverOn },
                      {
                        label: t('Definition source'),
                        getter: item => {
                          const origin = data.query.templateSources?.find(
                            source => source.name === item.name
                          )?.origin;
                          return origin === 'builtin'
                            ? t('Bundled Kiali template')
                            : origin === 'custom'
                            ? t('Saved custom definition')
                            : origin === 'namespace'
                            ? t('Namespace annotation')
                            : origin === 'workload'
                            ? t('Workload annotation')
                            : t('Source not captured');
                        },
                      },
                      {
                        label: t('Selection'),
                        getter: item => (
                          <Button onClick={() => onSelect(item.name)}>
                            {t('Select {{template}}', { template: item.name })}
                          </Button>
                        ),
                      },
                    ]}
                  />
                </SectionBox>
              ))
            )}
            <details>
              <summary>{t('Show captured dashboard discovery query')}</summary>
              <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {data.expression}
              </Typography>
            </details>
          </Stack>
        )}
      </RequestStatus>
    </SectionBox>
  );
}
