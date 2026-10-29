import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useKialiConfig } from '../config';
import { getClusterConfig, ServiceEndpoint } from '../core/config';
import { entityHealthQueries, EntityHealthQuery } from '../core/entityHealth';
import { HealthRateRule } from '../core/healthCalculator';
import { HealthReporterMode } from '../core/healthReporters';
import { clusterScope } from '../core/scope';
import {
  healthWorkloadKinds,
  isHealthWorkloadKind,
  workloadHealthQueries,
  WorkloadHealthQuery,
} from '../core/workloadHealth';
import { loadWorkloadHealth } from '../data/health';
import { useRequest } from '../hooks/useRequest';
import { useTelemetryQuery } from '../hooks/useTelemetryQuery';
import ClusterScope from './ClusterScope';
import EntityHealthResults from './EntityHealth';
import HealthSummary from './HealthSummary';
import RequestStatus from './RequestStatus';

function HealthResults({
  cluster,
  endpoint,
  query,
  rules,
}: {
  cluster: string;
  endpoint: ServiceEndpoint;
  query: WorkloadHealthQuery;
  rules: HealthRateRule[];
}) {
  const { t } = useTranslation();
  const sourceLabels = {
    resource: t('Kubernetes workload'),
    inbound: t('Inbound'),
    outbound: t('Outbound'),
  };
  const load = useCallback(
    (signal: AbortSignal) =>
      loadWorkloadHealth(clusterScope(cluster), endpoint, query, rules, signal),
    [cluster, endpoint, query, rules]
  );
  const state = useRequest(JSON.stringify([cluster, endpoint, query, rules]), load);
  return (
    <RequestStatus state={state} loadingLabel={t('Loading workload health...')}>
      {snapshot => (
        <SectionBox title={t('Health snapshot')}>
          <Stack spacing={2}>
            <Typography>
              {query.kind} {query.namespace}/{query.name} -{' '}
              {new Date(query.end * 1000).toLocaleString()}
            </Typography>
            <Alert severity="info">
              {t(
                'This combines Kubernetes replica health and five-minute HTTP/gRPC request rates. Proxy synchronization, ambient health and mesh security are not checked.'
              )}
            </Alert>
            {(['resource', 'inbound', 'outbound'] as const).map(key => {
              const read = snapshot[key];
              return read.ok === false ? (
                <Alert severity="error" key={key}>
                  {sourceLabels[key]}: {read.error.message}
                </Alert>
              ) : null;
            })}
            {[snapshot.inbound, snapshot.outbound].map((read, index) =>
              read.ok && read.result.warnings.length > 0 ? (
                <Alert severity="warning" key={index}>
                  {t('Prometheus returned warnings; results may be incomplete.')}{' '}
                  {read.result.warnings.join('; ')}
                </Alert>
              ) : null
            )}
            {snapshot.resource.ok && snapshot.resource.result.stale && (
              <Alert severity="warning">
                {t(
                  'The workload controller has not observed the current resource generation. Health is unavailable until it catches up.'
                )}
              </Alert>
            )}
            {snapshot.calculationError && (
              <Alert severity="error">{snapshot.calculationError.message}</Alert>
            )}
            {snapshot.calculation ? (
              <HealthSummary
                calculation={snapshot.calculation}
                label={t('Replica and request health')}
                includesReplicas
              />
            ) : (
              <Alert severity="warning">
                {t(
                  'Combined health is unavailable: replica state or telemetry is missing, stale, incomplete or invalid. No healthy status has been inferred.'
                )}
              </Alert>
            )}
            {snapshot.resource.ok && snapshot.resource.result.replicas && (
              <SimpleTable
                data={[snapshot.resource.result.replicas]}
                columns={[
                  { label: t('Desired replicas'), getter: item => item.desiredReplicas },
                  { label: t('Current replicas'), getter: item => item.currentReplicas },
                  { label: t('Available replicas'), getter: item => item.availableReplicas },
                ]}
              />
            )}
            <Typography variant="body2">
              {t(
                'Empty or zero-rate observations do not prove the absence of traffic. The sum includes both directions, not unique end-to-end requests.'
              )}
            </Typography>
          </Stack>
        </SectionBox>
      )}
    </RequestStatus>
  );
}

function HealthScope({ cluster }: { cluster: string }) {
  const { t } = useTranslation();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const [kind, setKind] = useState(params.get('kind') ?? 'Deployment');
  const [namespace, setNamespace] = useState(params.get('namespace') ?? '');
  const [name, setName] = useState(params.get('name') ?? '');
  const [telemetryApp, setTelemetryApp] = useState(params.get('telemetryApp') ?? '');
  const [reporterMode, setReporterMode] = useState<HealthReporterMode>(
    params.get('reporters') === 'single' ? 'single' : 'combined'
  );
  const [error, setError] = useState('');
  const config = useKialiConfig();
  const settings = config.valid ? getClusterConfig(config.config, cluster) : undefined;
  const {
    identity: telemetryCluster,
    setIdentity: setTelemetryCluster,
    query,
    setQuery,
    capturedSettings,
  } = useTelemetryQuery<WorkloadHealthQuery | EntityHealthQuery>(
    JSON.stringify([
      cluster,
      settings?.prometheus,
      settings?.telemetryCluster,
      settings?.appLabels,
      settings?.healthRates,
    ]),
    settings
  );
  return (
    <>
      <SectionBox title={t('Health')} headerProps={{ headerStyle: 'main' }}>
        <Stack spacing={2}>
          <Alert severity="info">
            {t(
              'Choose the exact Istio metric cluster label; it is not assumed to equal the Headlamp cluster name. Reporter mode is explicit below.'
            )}
          </Alert>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <TextField
              select
              label={t('Health subject')}
              value={kind}
              onChange={event => {
                setKind(event.target.value);
                setQuery(undefined);
              }}
            >
              <MenuItem value="Application">{t('Application')}</MenuItem>
              <MenuItem value="Service">{t('Service')}</MenuItem>
              {healthWorkloadKinds.map(kind => (
                <MenuItem key={kind} value={kind}>
                  {kind}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label={t('Namespace')}
              value={namespace}
              onChange={event => {
                setNamespace(event.target.value);
                setQuery(undefined);
              }}
            />
            <TextField
              label={
                kind === 'Application'
                  ? t('Application name')
                  : kind === 'Service'
                  ? t('Service name')
                  : t('Workload name')
              }
              value={name}
              onChange={event => {
                setName(event.target.value);
                setQuery(undefined);
              }}
            />
            {kind === 'Application' && (
              <TextField
                label={t('Istio canonical service label')}
                value={telemetryApp}
                onChange={event => {
                  setTelemetryApp(event.target.value);
                  setQuery(undefined);
                }}
                helperText={t(
                  'Enter the canonical_service metric value explicitly. A custom application label is not automatically a telemetry identity.'
                )}
              />
            )}
            <TextField
              label={t('Istio metric cluster label')}
              value={telemetryCluster}
              helperText={t(
                'Uses the saved explicit identity when available. Editing this form does not change settings. Endpoint, saved identity or health configuration changes clear submitted queries.'
              )}
              onChange={event => {
                setTelemetryCluster(event.target.value);
                setQuery(undefined);
              }}
            />
            <TextField
              select
              label={t('Health reporters')}
              value={reporterMode}
              onChange={event => {
                if (event.target.value === 'single' || event.target.value === 'combined')
                  setReporterMode(event.target.value);
                setQuery(undefined);
              }}
            >
              <MenuItem value="combined">{t('Kiali inbound combination')}</MenuItem>
              <MenuItem value="single">{t('Single reporter')}</MenuItem>
            </TextField>
            <Button
              variant="contained"
              disabled={!settings?.prometheus}
              onClick={() => {
                try {
                  const scope = {
                    namespace,
                    name,
                    telemetryCluster,
                    reporterMode,
                    end: Date.now() / 1000,
                  };
                  if (kind === 'Application' || kind === 'Service') {
                    const next: EntityHealthQuery =
                      kind === 'Application'
                        ? { ...scope, kind, telemetryApp }
                        : { ...scope, kind };
                    entityHealthQueries(next);
                    setQuery(next);
                  } else {
                    if (!isHealthWorkloadKind(kind))
                      throw new Error(t('Select a supported health subject'));
                    const next = { ...scope, kind };
                    workloadHealthQueries(next);
                    setQuery(next);
                  }
                  setError('');
                } catch (error) {
                  setQuery(undefined);
                  setError(error instanceof Error ? error.message : t('Invalid health query'));
                }
              }}
            >
              {t('Load health')}
            </Button>
          </Stack>
          <Typography variant="body2">
            {t(
              'Resource and metric reads share a 15-second deadline. A timeout is unavailable health evidence, not a healthy or zero-traffic result.'
            )}
          </Typography>
          <Typography variant="body2">
            {reporterMode === 'combined'
              ? t(
                  'Inbound combines the maximum source/destination rate per protocol and response code, matching Kiali. Outbound uses source reporting only. Missing reporter labels make combined health unavailable.'
                )
              : t(
                  'Single reporter mode retains the earlier behavior: destination inbound and source outbound. Errors visible only to the other reporter may be omitted.'
                )}
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          {config.valid === false && <Alert severity="error">{config.message}</Alert>}
          {!settings?.prometheus && (
            <Alert severity="info">
              {t('Configure an existing Prometheus Service before loading health.')}{' '}
              <Link routeName="kiali-settings">{t('Connection settings')}</Link>
            </Alert>
          )}
        </Stack>
      </SectionBox>
      {query &&
        capturedSettings?.prometheus &&
        (query.kind === 'Application' || query.kind === 'Service' ? (
          <EntityHealthResults
            cluster={cluster}
            endpoint={capturedSettings.prometheus}
            query={query}
            rules={capturedSettings.healthRates ?? EMPTY_RULES}
            appLabels={capturedSettings.appLabels ?? null}
          />
        ) : (
          <HealthResults
            cluster={cluster}
            endpoint={capturedSettings.prometheus}
            query={query}
            rules={capturedSettings.healthRates ?? EMPTY_RULES}
          />
        ))}
    </>
  );
}
const EMPTY_RULES: HealthRateRule[] = [];

export default function WorkloadHealth() {
  return (
    <ClusterScope>
      {scope => <HealthScope key={scope.cluster} cluster={scope.cluster} />}
    </ClusterScope>
  );
}
