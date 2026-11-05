import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Link } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback, useMemo, useState } from 'react';
import { useKialiConfig } from '../config';
import { getClusterConfig } from '../core/config';
import { clusterScope } from '../core/scope';
import { ReportedPodIdentity, reportedTracePod } from '../core/traceCorrelation';
import { TraceSpan } from '../core/tracing';
import { verifyTracePod, verifyTraceWorkload } from '../data/traceCorrelation';
import { useRequest } from '../hooks/useRequest';
import CorrelatedResourceName from './CorrelatedResourceName';
import RequestStatus from './RequestStatus';

function CurrentWorkload({
  cluster,
  identity,
  labels,
  captureKey,
  allowApplication,
}: {
  cluster: string;
  identity: ReportedPodIdentity;
  labels: ReturnType<typeof getClusterConfig>['appLabels'] | null;
  captureKey: string;
  allowApplication: boolean;
}) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) =>
      verifyTraceWorkload(clusterScope(cluster), identity, labels ?? null, signal),
    [cluster, identity, labels]
  );
  const result = useRequest(JSON.stringify([cluster, identity, labels, captureKey]), load);
  return (
    <RequestStatus state={result} loadingLabel={t('Capturing current UID owner relationships...')}>
      {current => (
        <Stack spacing={1}>
          <Alert severity="info">
            {t(
              'Current Kubernetes identities were captured at {{time}}. These are separate from the reported or historical trace attributes.',
              { time: new Date(current.checkedAt).toLocaleString() }
            )}
          </Alert>
          <Typography>
            {t('Reported Pod')}: {current.reportedPod.namespace}/{current.reportedPod.name}{' '}
            <code>{current.reportedPod.uid}</code>
          </Typography>
          <Typography>
            {t('Current Pod')}: {current.pod.namespace}/{current.pod.name}{' '}
            <code>{current.pod.uid}</code>
          </Typography>
          <Typography>
            {t('Current workload')}:{' '}
            <CorrelatedResourceName resource={{ identity: current.workload }} />{' '}
            <code>{current.workload.uid}</code>
          </Typography>
          {allowApplication && current.application && (
            <Link
              routeName="kiali-applications"
              activeCluster={current.application.cluster}
              search={new URLSearchParams({
                namespace: current.application.namespace,
                application: current.application.name,
              }).toString()}
            >
              {t('Open current application')}
            </Link>
          )}
          <Alert severity="info">
            {t(
              'Graph association is not established. The traffic graph is a separate Prometheus rate-window snapshot with name-based telemetry identities, not this Kubernetes UID or trace/span ID. No edge, highlight, cause, or health verdict is inferred.'
            )}
          </Alert>
          <Link
            routeName="kiali-graph"
            activeCluster={current.workload.cluster}
            search={new URLSearchParams({ namespace: current.workload.namespace }).toString()}
          >
            {t('Open traffic graph for this namespace')}
          </Link>
        </Stack>
      )}
    </RequestStatus>
  );
}

function VerifiedPod({
  cluster,
  identity,
  labels,
  captureKey,
  allowApplication,
}: {
  cluster: string;
  identity: ReportedPodIdentity;
  labels: ReturnType<typeof getClusterConfig>['appLabels'] | null;
  captureKey: string;
  allowApplication: boolean;
}) {
  const { t } = useTranslation();
  const [workloadAttempt, setWorkloadAttempt] = useState(0);
  const load = useCallback(
    (signal: AbortSignal) => verifyTracePod(clusterScope(cluster), identity, signal),
    [cluster, identity]
  );
  const result = useRequest(JSON.stringify([cluster, identity]), load);
  return (
    <RequestStatus state={result} loadingLabel={t('Verifying the reported Pod UID...')}>
      {pod => (
        <Stack spacing={1}>
          <Alert severity="info">
            {t(
              'Pod UID matched at {{time}} in {{cluster}}. This checks the reported object identity, not the origin of the trace. The current Pod may change after this check.',
              { time: new Date(pod.checkedAt).toLocaleString(), cluster: pod.cluster }
            )}
          </Alert>
          <Link
            routeName="Pod"
            activeCluster={pod.cluster}
            params={{ namespace: pod.namespace, name: pod.name }}
          >
            {t('Open verified Pod')}
          </Link>
          <Link
            routeName="kiali-diagnostics"
            activeCluster={pod.cluster}
            search={new URLSearchParams({ namespace: pod.namespace, pod: pod.name }).toString()}
          >
            {t('Open Pod diagnostics')}
          </Link>
          <Button onClick={() => setWorkloadAttempt(attempt => attempt + 1)}>
            {t('Verify current workload owner')}
          </Button>
          {workloadAttempt > 0 && (
            <CurrentWorkload
              key={`${captureKey}:${workloadAttempt}`}
              cluster={cluster}
              identity={identity}
              labels={labels}
              captureKey={captureKey}
              allowApplication={allowApplication}
            />
          )}
        </Stack>
      )}
    </RequestStatus>
  );
}

export default function TracePodCorrelation({
  cluster,
  span,
  traceCaptureKey = '',
}: {
  cluster: string;
  span: TraceSpan;
  traceCaptureKey?: string;
}) {
  const { t } = useTranslation();
  const config = useKialiConfig();
  const reference = useMemo(() => reportedTracePod(span), [span]);
  const labels =
    config.valid === true ? getClusterConfig(config.config, cluster).appLabels ?? null : null;
  const captureKey = JSON.stringify([
    cluster,
    span.traceId,
    span.id,
    span.startNs,
    span.durationNs,
    traceCaptureKey,
    config,
  ]);
  const key = JSON.stringify([
    captureKey,
    reference.status === 'ready' ? reference.identity : null,
  ]);
  const [request, setRequest] = useState<{ key: string; attempt: number }>();
  const active = request?.key === key ? request : undefined;
  const origins = {
    resource: t('resource/process'),
    span: t('span'),
    mixed: t('resource/process and span'),
  };
  const reasons = {
    absent: t(
      'No Kubernetes Pod identity attributes were reported. Service names are not used to guess a Pod.'
    ),
    incomplete: t(
      'Pod verification requires k8s.namespace.name, k8s.pod.name and k8s.pod.uid. No name-only lookup is performed.'
    ),
    conflicting: t('Reported Pod identity attributes conflict; no Pod lookup is performed.'),
    invalid: t(
      'Reported Pod identity attributes are invalid or oversized; no Pod lookup is performed.'
    ),
  };
  return (
    <Stack spacing={2}>
      <Typography variant="h6" component="h3">
        {t('Reported Kubernetes Pod')}
      </Typography>
      {reference.status === 'unavailable' ? (
        <Typography>{reasons[reference.reason]}</Typography>
      ) : (
        <>
          <Typography sx={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
            {reference.identity.namespace}/{reference.identity.name} -{' '}
            <code>{reference.identity.uid}</code>
          </Typography>
          <Typography variant="body2">
            {t('Identity reported in {{source}} attributes.', {
              source: origins[reference.origin],
            })}
          </Typography>
          <Typography variant="body2">
            {t(
              'This optional lookup uses the selected Headlamp cluster, not backend service names or reported cluster labels. Historical Pods may no longer exist.'
            )}
          </Typography>
          <Button
            onClick={() =>
              setRequest(current => ({
                key,
                attempt: current?.key === key ? current.attempt + 1 : 1,
              }))
            }
          >
            {t('Verify reported pod in this cluster')}
          </Button>
          {active && (
            <VerifiedPod
              key={`${key}:${active.attempt}`}
              cluster={cluster}
              identity={reference.identity}
              labels={labels}
              captureKey={captureKey}
              allowApplication={config.valid === true}
            />
          )}
        </>
      )}
    </Stack>
  );
}
