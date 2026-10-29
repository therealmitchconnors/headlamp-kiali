import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback } from 'react';
import { ServiceEndpoint } from '../core/config';
import { CorrelatedWorkload } from '../core/correlation';
import { EntityHealthQuery } from '../core/entityHealth';
import { HealthRateRule } from '../core/healthCalculator';
import { AppLabels } from '../core/labels';
import { clusterScope } from '../core/scope';
import { loadEntityHealth } from '../data/entityHealth';
import { useRequest } from '../hooks/useRequest';
import HealthSummary from './HealthSummary';
import RequestStatus from './RequestStatus';

export default function EntityHealthResults({
  cluster,
  endpoint,
  query,
  rules,
  appLabels,
}: {
  cluster: string;
  endpoint: ServiceEndpoint;
  query: EntityHealthQuery;
  rules: readonly HealthRateRule[];
  appLabels: AppLabels | null;
}) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) =>
      loadEntityHealth(clusterScope(cluster), endpoint, query, rules, appLabels, signal),
    [cluster, endpoint, query, rules, appLabels]
  );
  const result = useRequest(JSON.stringify([cluster, endpoint, query, rules, appLabels]), load);
  return (
    <RequestStatus state={result} loadingLabel={t('Loading entity health...')}>
      {snapshot => (
        <SectionBox title={t('Health snapshot')}>
          <Stack spacing={2}>
            <Typography>
              {query.kind === 'Application' ? t('Application') : t('Service')} {query.namespace}/
              {query.name || t('Empty application label')} -{' '}
              {new Date(query.end * 1000).toLocaleString()}
            </Typography>
            <Alert severity="info">
              {query.kind === 'Application'
                ? t(
                    'Application health combines supported controller replicas and five-minute canonical-service request rates. Discovered WorkloadGroups remain unassessed until VM health is supported; entries are not counted as ready Pods. Application health rules apply; individual workload rate annotations do not. This does not assess proxy synchronization, ambient or security.'
                  )
                : t(
                    'Service health uses inbound requests and Service health annotations only. It does not assess endpoint readiness, replica availability, proxy synchronization or security.'
                  )}
            </Alert>
            {snapshot.resourceError && (
              <Alert severity="error">{snapshot.resourceError.message}</Alert>
            )}
            {(
              [
                ['inbound', snapshot.inbound],
                ['outbound', snapshot.outbound],
              ] as const
            ).map(([direction, read]) =>
              read?.ok === false ? (
                <Alert severity="error" key={direction}>
                  {direction === 'inbound' ? t('Inbound') : t('Outbound')}: {read.error.message}
                </Alert>
              ) : read?.ok && read.result.warnings.length ? (
                <Alert severity="warning" key={direction}>
                  {read.result.warnings.join('; ')}
                </Alert>
              ) : null
            )}
            {snapshot.issues.map((message, index) => (
              <Alert severity="warning" key={index}>
                {message}
              </Alert>
            ))}
            {snapshot.calculation ? (
              <HealthSummary
                calculation={snapshot.calculation}
                includesReplicas={query.kind === 'Application'}
                label={
                  query.kind === 'Application'
                    ? t('Replica and request health')
                    : t('Service request health')
                }
              />
            ) : (
              <Alert severity="warning">
                {t(
                  'Health is unavailable from incomplete, missing or invalid evidence. No healthy status was inferred.'
                )}
              </Alert>
            )}
            {snapshot.application && (
              <SimpleTable
                data={snapshot.application.workloads.slice(0, 100)}
                columns={[
                  {
                    label: t('Workload'),
                    getter: (workload: CorrelatedWorkload) =>
                      `${workload.identity.kind}/${workload.identity.name}`,
                  },
                  {
                    label: t('Desired replicas'),
                    getter: (workload: CorrelatedWorkload) =>
                      workload.resource.health?.ok
                        ? workload.resource.health.value.replicas?.desiredReplicas ??
                          t('Unavailable')
                        : t('Unavailable'),
                  },
                  {
                    label: t('Current replicas'),
                    getter: (workload: CorrelatedWorkload) =>
                      workload.resource.health?.ok
                        ? workload.resource.health.value.replicas?.currentReplicas ??
                          t('Unavailable')
                        : t('Unavailable'),
                  },
                  {
                    label: t('Available replicas'),
                    getter: (workload: CorrelatedWorkload) =>
                      workload.resource.health?.ok
                        ? workload.resource.health.value.replicas?.availableReplicas ??
                          t('Unavailable')
                        : t('Unavailable'),
                  },
                ]}
              />
            )}
            <Typography variant="body2">
              {t(
                'Only the explicit telemetry cluster is queried. Unknown-cluster fallback and external registry Services are not included. Inbound plus outbound is not a unique end-to-end request count.'
              )}
            </Typography>
          </Stack>
        </SectionBox>
      )}
    </RequestStatus>
  );
}
