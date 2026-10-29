import { K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';
import { useKialiConfig } from '../config';
import { getClusterConfig } from '../core/config';
import { GraphResourceTarget, graphResourceTarget } from '../core/graphResources';
import { AppLabels } from '../core/labels';
import { TopologyNode } from '../core/topology';
import { loadGraphResources } from '../data/graphResources';
import { useRequest } from '../hooks/useRequest';
import CorrelatedResourceName from './CorrelatedResourceName';
import RequestStatus from './RequestStatus';
import WorkloadLabelSource from './WorkloadLabelSource';

function Candidates({ target, labels }: { target: GraphResourceTarget; labels: AppLabels | null }) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) => loadGraphResources(target, labels, signal),
    [target, labels]
  );
  const state = useRequest(JSON.stringify([target, labels]), load);
  return (
    <RequestStatus
      state={state}
      loadingLabel={t('Reading current Kubernetes resource candidates...')}
    >
      {result => (
        <Stack spacing={1}>
          <Typography>
            {t('Observed current candidates in {{cluster}} at {{time}}', {
              cluster: result.target.cluster,
              time: result.checkedAt,
            })}
          </Typography>
          <SimpleTable
            data={result.candidates}
            emptyMessage={t(
              'No unambiguous supported Kubernetes candidates were observed. This does not prove mesh workload absence.'
            )}
            columns={[
              { label: t('Kind'), getter: item => item.identity.kind },
              {
                label: t('Current resource'),
                getter: item => <CorrelatedResourceName resource={item} />,
              },
              { label: t('Namespace'), getter: item => item.identity.namespace },
              { label: t('Observed UID'), getter: item => item.identity.uid },
              {
                label: t('Label evidence'),
                getter: item => (
                  <WorkloadLabelSource
                    identity={item.identity}
                    virtualMachine={item.virtualMachine}
                  />
                ),
              },
              {
                label: t('Current application label'),
                getter: item => item.app ?? t('Not reported'),
              },
              {
                label: t('Current version label'),
                getter: item => item.version ?? t('Not reported'),
              },
            ]}
          />
          {result.unresolved.map(item => (
            <Alert key={item.name} severity="warning">
              {item.reason === 'ambiguous'
                ? t('{{name}} matches multiple supported workload kinds; no resource was chosen.', {
                    name: item.name,
                  })
                : t(
                    '{{name}} was not observed among supported current resources; historical or external workloads may differ.',
                    { name: item.name }
                  )}
            </Alert>
          ))}
        </Stack>
      )}
    </RequestStatus>
  );
}
export default function GraphResources({
  node,
  cluster,
  telemetryCluster,
}: {
  node: TopologyNode;
  cluster: string;
  telemetryCluster: string;
}) {
  const { t } = useTranslation();
  const config = useKialiConfig();
  const available = K8s.useClustersConf();
  let target: GraphResourceTarget | undefined;
  let error: string | undefined;
  try {
    if (config.valid === false) throw new Error(config.message);
    target = graphResourceTarget(
      node,
      { cluster, telemetryCluster },
      config.config,
      Object.keys(available ?? {})
    );
  } catch (failure) {
    error = failure instanceof Error ? failure.message : t('Graph resource mapping is unavailable');
  }
  const labels =
    target && config.valid
      ? getClusterConfig(config.config, target.cluster).appLabels ?? null
      : null;
  const binding = JSON.stringify([node, target, labels, error]);
  const [submitted, setSubmitted] = useState<{
    binding: string;
    target: GraphResourceTarget;
    labels: AppLabels | null;
    attempt: number;
  }>();
  useEffect(() => setSubmitted(undefined), [binding]);
  return (
    <Stack spacing={1}>
      <Alert severity="info">
        {t(
          'This optional lookup matches reported names against current supported Kubernetes resources. Telemetry supplies no Kubernetes UID, so this cannot verify historical identity or prove that the current resource produced the traffic. Listed UIDs are current observations; links are name-based and can change.'
        )}
      </Alert>
      {error ? (
        <Alert severity="warning">{error}</Alert>
      ) : (
        target && (
          <>
            <Button
              onClick={() =>
                setSubmitted(previous => ({
                  binding,
                  target: structuredClone(target),
                  labels: structuredClone(labels),
                  attempt: (previous?.attempt ?? 0) + 1,
                }))
              }
            >
              {t('Find current resource candidates in {{cluster}}', { cluster: target.cluster })}
            </Button>
            {submitted?.binding === binding && (
              <Candidates
                key={submitted.attempt}
                target={submitted.target}
                labels={submitted.labels}
              />
            )}
          </>
        )
      )}
    </Stack>
  );
}
