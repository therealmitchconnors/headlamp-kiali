import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useKialiConfig } from '../config';
import { ApplicationDashboardEvidence } from '../core/applicationDashboards';
import { ClusterConfig, getClusterConfig } from '../core/config';
import {
  DASHBOARD_WORKLOAD_KINDS,
  DashboardWorkloadKind,
  validateDashboardAnnotationTarget,
} from '../core/dashboardAnnotations';
import { namespaceScope } from '../core/scope';
import { captureWorkloadDashboardEvidence } from '../core/workloadDashboards';
import { loadCorrelationSnapshot } from '../data/correlation';
import { useRequest } from '../hooks/useRequest';
import { useTelemetryQuery } from '../hooks/useTelemetryQuery';
import { InspectionQuery, InspectionResults } from './ApplicationDashboards';
import ClusterScope from './ClusterScope';
import ResourceName from './CorrelatedResourceName';
import RequestStatus from './RequestStatus';

interface WorkloadRequest {
  namespace: string;
  kind: DashboardWorkloadKind;
  name: string;
  uid?: string;
  attempt: number;
}

function WorkloadInspector({
  evidence,
  settings,
}: {
  evidence: ApplicationDashboardEvidence;
  settings: ClusterConfig;
}) {
  const { t } = useTranslation();
  const binding = JSON.stringify([evidence, settings]);
  const { identity, setIdentity, query, setQuery, capturedSettings } =
    useTelemetryQuery<InspectionQuery>(binding, settings);
  const [acknowledged, setAcknowledged] = useState<string>();
  useEffect(() => setAcknowledged(undefined), [binding]);
  return (
    <Stack spacing={2}>
      <Alert severity="info">
        {t(
          'Recommendations use captured UID-attributed Pods and the workload application/version labels. Namespace templates apply first, workload templates last. These label selectors can match other workloads too; references and metric matches do not prove runtime, ownership of telemetry or health.'
        )}
      </Alert>
      <Typography>
        {t('Captured app label value: {{app}}; version value: {{version}}', {
          app: evidence.application,
          version: evidence.workload?.version || t('Not set; no version filter'),
        })}
      </Typography>
      <TextField
        label={t('Workload dashboard metric cluster')}
        value={identity}
        onChange={event => setIdentity(event.target.value)}
      />
      {settings.customDashboards?.clusterLabel === null && (
        <FormControlLabel
          label={t('I confirm the workload dashboard metrics source contains only one cluster')}
          control={
            <Checkbox
              checked={acknowledged === binding}
              onChange={event => setAcknowledged(event.target.checked ? binding : undefined)}
            />
          }
        />
      )}
      <Button
        variant="outlined"
        onClick={() =>
          setQuery({
            evidence: structuredClone(evidence),
            metricCluster: identity,
            confirmed: acknowledged === binding,
          })
        }
      >
        {t('Inspect workload dashboard recommendations')}
      </Button>
      {query && capturedSettings && <InspectionResults query={query} settings={capturedSettings} />}
    </Stack>
  );
}

function WorkloadSnapshot({
  cluster,
  request,
  settings,
}: {
  cluster: string;
  request: WorkloadRequest;
  settings: ClusterConfig;
}) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) =>
      loadCorrelationSnapshot(namespaceScope(cluster, request.namespace), signal),
    [cluster, request]
  );
  const state = useRequest(JSON.stringify([cluster, request]), load);
  return (
    <RequestStatus state={state} loadingLabel={t('Reading workload ownership evidence...')}>
      {snapshot => {
        let evidence: ApplicationDashboardEvidence;
        try {
          evidence = captureWorkloadDashboardEvidence(
            snapshot.scope,
            snapshot.resources,
            snapshot.complete,
            request,
            settings.appLabels
          );
        } catch (error) {
          return (
            <Alert severity="error">
              {error instanceof Error
                ? error.message
                : t('Workload dashboard evidence is unavailable')}
            </Alert>
          );
        }
        const resource = snapshot.resources.find(
          item => item.identity.uid === evidence.workload?.uid
        );
        return (
          <SectionBox title={t('Captured workload evidence')}>
            <Stack spacing={2}>
              {resource && <ResourceName resource={resource} />}
              <Typography>
                {t(
                  'Resource links, where available, open Headlamp native details. This inspector does not replace specification, status, conditions or events views.'
                )}
              </Typography>
              {!evidence.complete && (
                <Alert severity="warning">
                  {t(
                    'Supported-source ownership evidence is incomplete. Positive references can be inspected, but missing references cannot initiate metric discovery.'
                  )}
                </Alert>
              )}
              <details>
                <summary>{t('Show workload ownership source outcomes')}</summary>
                <SimpleTable
                  data={snapshot.sources}
                  columns={[
                    { label: t('Kind'), getter: source => source.source.kind },
                    {
                      label: t('Outcome'),
                      getter: source =>
                        source.error?.message ??
                        (source.complete ? t('Complete read') : t('Incomplete read')),
                    },
                  ]}
                />
              </details>
              <WorkloadInspector evidence={evidence} settings={settings} />
            </Stack>
          </SectionBox>
        );
      }}
    </RequestStatus>
  );
}

function WorkloadScope({ cluster }: { cluster: string }) {
  const { t } = useTranslation();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const [kind, setKind] = useState(params.get('kind') ?? 'Deployment');
  const [namespace, setNamespace] = useState(params.get('namespace') ?? '');
  const [name, setName] = useState(params.get('name') ?? '');
  const [uid, setUid] = useState<string | undefined>(params.get('uid') ?? undefined);
  const [error, setError] = useState('');
  const config = useKialiConfig();
  const settings = config.valid ? getClusterConfig(config.config, cluster) : undefined;
  const binding = JSON.stringify([cluster, namespace, kind, name, uid, settings]);
  const [request, setRequest] = useState<{ binding: string; value: WorkloadRequest }>();
  useEffect(() => {
    setRequest(undefined);
    setError('');
  }, [binding]);
  return (
    <>
      <SectionBox title={t('Workload dashboards')} headerProps={{ headerStyle: 'main' }}>
        <Stack spacing={2}>
          <Typography>
            {t(
              'Read one supported workload and its namespace ownership snapshot before inspecting dashboard references. Reads are explicit and bounded; nothing is installed or written to the cluster. VM and custom-controller annotation sources are not supported here.'
            )}
          </Typography>
          <TextField
            select
            label={t('Dashboard workload kind')}
            value={kind}
            onChange={event => {
              setKind(event.target.value);
              setUid(undefined);
            }}
          >
            {Object.keys(DASHBOARD_WORKLOAD_KINDS).map(kind => (
              <MenuItem key={kind} value={kind}>
                {kind}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('Dashboard workload namespace')}
            value={namespace}
            onChange={event => {
              setNamespace(event.target.value);
              setUid(undefined);
            }}
          />
          <TextField
            label={t('Dashboard workload name')}
            value={name}
            onChange={event => {
              setName(event.target.value);
              setUid(undefined);
            }}
          />
          {uid && <Typography>{t('Linked workload UID: {{uid}}', { uid })}</Typography>}
          <Link routeName="kiali-settings" params={{ cluster }}>
            {t('Configure workload dashboard discovery')}
          </Link>
          <Button
            variant="contained"
            disabled={!settings}
            onClick={() => {
              try {
                namespaceScope(cluster, namespace);
                const selected = Object.keys(DASHBOARD_WORKLOAD_KINDS).find(
                  (candidate): candidate is DashboardWorkloadKind => candidate === kind
                );
                if (!selected) throw new Error(t('Choose a supported workload kind'));
                validateDashboardAnnotationTarget({
                  namespace,
                  workload: { kind: selected, name },
                });
                if (uid !== undefined && (!uid || uid.length > 1024 || uid.trim() !== uid))
                  throw new Error(t('Linked workload UID is invalid'));
                setError('');
                setRequest(current => ({
                  binding,
                  value: {
                    namespace,
                    kind: selected,
                    name,
                    uid,
                    attempt: (current?.value.attempt ?? 0) + 1,
                  },
                }));
              } catch (error) {
                setRequest(undefined);
                setError(
                  error instanceof Error ? error.message : t('Invalid workload dashboard scope')
                );
              }
            }}
          >
            {t('Read workload dashboard evidence')}
          </Button>
          {config.valid === false && <Alert severity="error">{config.message}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </SectionBox>
      {request?.binding === binding && settings && (
        <WorkloadSnapshot
          key={JSON.stringify([binding, request.value.attempt])}
          cluster={cluster}
          request={request.value}
          settings={settings}
        />
      )}
    </>
  );
}

export default function WorkloadDashboards() {
  const location = useLocation();
  return (
    <ClusterScope>
      {scope => (
        <WorkloadScope
          key={JSON.stringify([scope.cluster, location.search])}
          cluster={scope.cluster}
        />
      )}
    </ClusterScope>
  );
}
