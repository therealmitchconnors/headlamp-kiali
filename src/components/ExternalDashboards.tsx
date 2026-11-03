import { K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useState } from 'react';
import { useKialiConfig } from '../config';
import {
  ExternalDashboardProvider,
  getClusterConfig,
  GrafanaDashboardConfig,
  PersesDashboardConfig,
} from '../core/config';
import { ExternalDashboardContext } from '../core/externalDashboards';
import { clusterScope } from '../core/scope';
import { discoverExternalDashboards } from '../data/externalDashboards';
import { useRequest } from '../hooks/useRequest';
import RequestStatus from './RequestStatus';

type ProviderConfig = GrafanaDashboardConfig | PersesDashboardConfig;
interface SubmittedDiscovery {
  binding: string;
  cluster: string;
  provider: ExternalDashboardProvider;
  config: ProviderConfig;
  context: ExternalDashboardContext;
}

function localDateTime(milliseconds: number): string {
  const date = new Date(milliseconds);
  const part = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(
    date.getHours()
  )}:${part(date.getMinutes())}`;
}

function ExternalDashboardResults({
  submission,
}: {
  submission: SubmittedDiscovery;
}) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) =>
      discoverExternalDashboards(
        clusterScope(submission.cluster),
        submission.provider,
        submission.config,
        submission.context,
        signal
      ),
    [submission]
  );
  const state = useRequest(submission.binding, load);
  return (
    <RequestStatus
      state={state}
      loadingLabel={t('Discovering {{provider}} dashboards...', {
        provider: submission.provider,
      })}
    >
      {result => (
        <Stack spacing={2}>
          <Alert severity={result.capability === 'verified' ? 'success' : 'warning'}>
            {result.capability === 'verified'
              ? t(
                  '{{provider}} dashboard API responded through the Kubernetes Service proxy. This does not authenticate to the provider or verify that your browser can reach the external link.',
                  { provider: submission.provider }
                )
              : t(
                  'No configured dashboard was verified. The {{provider}} API capability is unverified; the dashboard may be missing or this provider endpoint may not support the expected API.',
                  { provider: submission.provider }
                )}
          </Alert>
          {!!result.missing.length && (
            <Alert severity="info">
              {t('Not discovered: {{names}}', { names: result.missing.join(', ') })}
            </Alert>
          )}
          {result.dashboards.map(dashboard => (
            <Button
              key={dashboard.name}
              component="a"
              href={dashboard.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('Open {{name}} in {{provider}} in a new tab', {
                name: dashboard.name,
                provider: submission.provider,
              })}
            >
              {t('Open {{name}} in {{provider}} (external)', {
                name: dashboard.name,
                provider: submission.provider,
              })}
            </Button>
          ))}
          {!result.dashboards.length && !result.missing.length && (
            <Alert severity="info">{t('No external dashboards were returned.')}</Alert>
          )}
        </Stack>
      )}
    </RequestStatus>
  );
}

export default function ExternalDashboards() {
  const { t } = useTranslation();
  const selected = K8s.useSelectedClusters();
  const configState = useKialiConfig();
  const cluster = selected.length === 1 ? selected[0] : '';
  const settings =
    cluster && configState.valid ? getClusterConfig(configState.config, cluster) : undefined;
  const [provider, setProvider] = useState<ExternalDashboardProvider>('grafana');
  const [namespace, setNamespace] = useState('');
  const [service, setService] = useState('');
  const [application, setApplication] = useState('');
  const [workload, setWorkload] = useState('');
  const [version, setVersion] = useState('');
  const [start, setStart] = useState(() => localDateTime(Date.now() - 60 * 60 * 1000));
  const [end, setEnd] = useState(() => localDateTime(Date.now()));
  const [submission, setSubmission] = useState<SubmittedDiscovery>();
  const activeProvider: ExternalDashboardProvider = settings?.externalDashboards?.[provider]
    ? provider
    : settings?.externalDashboards?.grafana
    ? 'grafana'
    : settings?.externalDashboards?.perses
    ? 'perses'
    : provider;
  const providerConfig = settings?.externalDashboards?.[activeProvider];
  const startTime = Date.parse(start);
  const endTime = Date.parse(end);
  const validRange =
    Number.isFinite(startTime) &&
    Number.isFinite(endTime) &&
    startTime >= 0 &&
    startTime < endTime &&
    endTime <= 8_640_000_000_000_000;
  const context: ExternalDashboardContext = {
    cluster: settings?.telemetryCluster ?? undefined,
    namespace,
    service,
    application,
    workload,
    version,
    start: validRange ? startTime : 0,
    end: validRange ? endTime : 0,
  };
  const binding = JSON.stringify([cluster, activeProvider, providerConfig, context]);
  const currentSubmission =
    submission?.binding === binding ? submission : undefined;

  return (
    <SectionBox title={t('External dashboards')} headerProps={{ headerStyle: 'main' }}>
      <Stack spacing={2} sx={{ maxWidth: 720 }}>
        <Typography>
          {t(
            'Discover configured Grafana or Perses dashboards and open them in a new tab. Requests use the selected cluster’s Kubernetes Service proxy without provider credentials. This is external linking, not native dashboard rendering or authenticated provider integration.'
          )}
        </Typography>
        {configState.valid === false ? (
          <Alert severity="error">
            {t('Stored Kiali configuration is invalid: {{message}}', {
              message: configState.message,
            })}
          </Alert>
        ) : selected.length !== 1 ? (
          <Alert severity="warning">
            {t(
              'Select exactly one cluster before discovering external dashboards. Grouped cluster selections are not used as link targets.'
            )}
          </Alert>
        ) : !settings?.externalDashboards ||
          (!settings.externalDashboards.grafana && !settings.externalDashboards.perses) ? (
          <Alert severity="info">
            {t(
              'External dashboard endpoints are not configured. Add provider settings under Kiali > Connection settings; no provider credentials are stored.'
            )}
          </Alert>
        ) : (
          <>
            <TextField
              select
              label={t('Dashboard provider')}
              value={activeProvider}
              onChange={event => {
                if (event.target.value === 'grafana' || event.target.value === 'perses')
                  setProvider(event.target.value);
                setSubmission(undefined);
              }}
            >
              {settings.externalDashboards.grafana && <MenuItem value="grafana">Grafana</MenuItem>}
              {settings.externalDashboards.perses && <MenuItem value="perses">Perses</MenuItem>}
            </TextField>
            {!providerConfig ? (
              <Alert severity="info">
                {t('{{provider}} settings are not configured for this cluster.', {
                  provider: activeProvider,
                })}
              </Alert>
            ) : (
              <>
                <Typography variant="body2">
                  {t(
                    'Cluster variables use the explicitly saved metric-cluster identity only; the Headlamp context name is never substituted. Application and workload values below are literal inputs, not verified Kubernetes relationships.'
                  )}
                </Typography>
                <TextField
                  label={t('Dashboard namespace variable')}
                  value={namespace}
                  onChange={event => {
                    setNamespace(event.target.value);
                    setSubmission(undefined);
                  }}
                />
                <TextField
                  label={t('Dashboard service variable')}
                  value={service}
                  onChange={event => {
                    setService(event.target.value);
                    setSubmission(undefined);
                  }}
                  helperText={t(
                    'Mapped as the Kiali service DNS name, including namespace and svc.cluster.local.'
                  )}
                />
                <TextField
                  label={t('Dashboard application variable')}
                  value={application}
                  onChange={event => {
                    setApplication(event.target.value);
                    setSubmission(undefined);
                  }}
                />
                <TextField
                  label={t('Dashboard workload variable')}
                  value={workload}
                  onChange={event => {
                    setWorkload(event.target.value);
                    setSubmission(undefined);
                  }}
                />
                <TextField
                  label={t('Dashboard version variable')}
                  value={version}
                  onChange={event => {
                    setVersion(event.target.value);
                    setSubmission(undefined);
                  }}
                />
                <TextField
                  type="datetime-local"
                  label={t('Historical range start')}
                  value={start}
                  onChange={event => {
                    setStart(event.target.value);
                    setSubmission(undefined);
                  }}
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  type="datetime-local"
                  label={t('Historical range end')}
                  value={end}
                  onChange={event => {
                    setEnd(event.target.value);
                    setSubmission(undefined);
                  }}
                  InputLabelProps={{ shrink: true }}
                />
                <Button
                  variant="contained"
                  disabled={!validRange}
                  onClick={() => {
                    if (providerConfig && validRange) {
                      setSubmission({
                        binding,
                        cluster,
                        provider: activeProvider,
                        config: structuredClone(providerConfig),
                        context: structuredClone(context),
                      });
                    }
                  }}
                >
                  {t('Discover {{provider}} dashboards', { provider: activeProvider })}
                </Button>
                {!validRange && (
                  <Alert severity="warning">
                    {t('Choose a valid historical range with an end later than its start.')}
                  </Alert>
                )}
                {currentSubmission ? (
                  <ExternalDashboardResults
                    key={currentSubmission.binding}
                    submission={currentSubmission}
                  />
                ) : (
                  submission && (
                    <Alert severity="info">
                      {t(
                        'The cluster, provider settings, variables, or time range changed. Previous discovery results were discarded; discover again.'
                      )}
                    </Alert>
                  )
                )}
              </>
            )}
          </>
        )}
      </Stack>
    </SectionBox>
  );
}
