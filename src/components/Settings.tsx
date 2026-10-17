import { K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { ConfirmDialog, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useState } from 'react';
import { configStore, saveClusterConfig, useKialiConfig } from '../config';
import {
  ConfigurationError,
  getClusterConfig,
  ServiceEndpoint,
  validateAppLabels,
  validateServiceEndpoint,
} from '../core/config';
import { AppLabels } from '../core/labels';
import { clusterScope } from '../core/scope';
import { inspectPrometheus } from '../data/requests';
import { useRequest } from '../hooks/useRequest';
import RequestStatus from './RequestStatus';

const EMPTY_ENDPOINT: ServiceEndpoint = { namespace: '', service: '', port: '9090', basePath: '' };

function ConnectionCheck({ cluster, endpoint }: { cluster: string; endpoint: ServiceEndpoint }) {
  const { t } = useTranslation();
  const key = JSON.stringify([cluster, endpoint]);
  const load = useCallback(
    (signal: AbortSignal) => inspectPrometheus(clusterScope(cluster), endpoint, signal),
    [cluster, endpoint]
  );
  const result = useRequest(key, load);
  return (
    <RequestStatus state={result}>
      {data => (
        <Alert severity="success">
          {t('Connected to Prometheus {{version}} in {{cluster}}.', {
            version: data.version,
            cluster,
          })}
        </Alert>
      )}
    </RequestStatus>
  );
}

function ClusterSettingsForm({
  cluster,
  initialEndpoint,
  initialLabels,
}: {
  cluster: string;
  initialEndpoint: ServiceEndpoint | null;
  initialLabels?: AppLabels | null;
}) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(initialEndpoint !== null);
  const [draft, setDraft] = useState(initialEndpoint ?? EMPTY_ENDPOINT);
  const [customLabels, setCustomLabels] = useState(!!initialLabels);
  const [labelDraft, setLabelDraft] = useState(initialLabels ?? { app: 'app', version: 'version' });
  const [feedback, setFeedback] = useState<{ error: boolean; message: string }>();
  const [check, setCheck] = useState<{ endpoint: ServiceEndpoint; attempt: number }>();
  let endpoint: ServiceEndpoint | null = null;
  let endpointValidation: string | undefined;
  let labelValidation: string | undefined;
  let appLabels: AppLabels | null = null;
  if (enabled) {
    try {
      endpoint = validateServiceEndpoint(draft);
    } catch (error) {
      if (!(error instanceof ConfigurationError)) {
        throw error;
      }
      endpointValidation = error.message;
    }
  }
  if (customLabels) {
    try {
      appLabels = validateAppLabels(labelDraft);
    } catch (error) {
      if (!(error instanceof ConfigurationError)) throw error;
      labelValidation = error.message;
    }
  }
  const validation = endpointValidation ?? labelValidation;

  function change(field: keyof ServiceEndpoint, value: string) {
    setDraft(current => ({ ...current, [field]: value }));
    setFeedback(undefined);
    setCheck(undefined);
  }

  function save() {
    if (validation) {
      setFeedback({ error: true, message: validation });
      return;
    }
    try {
      saveClusterConfig(cluster, { prometheus: endpoint, appLabels });
      setFeedback({ error: false, message: t('Settings saved for {{cluster}}.', { cluster }) });
    } catch (error) {
      setFeedback({
        error: true,
        message: error instanceof Error ? error.message : t('Unable to save settings.'),
      });
    }
  }

  return (
    <Stack spacing={2}>
      <FormControlLabel
        label={t('Connect to an existing Prometheus Service')}
        control={
          <Switch
            checked={enabled}
            onChange={event => {
              setEnabled(event.target.checked);
              setFeedback(undefined);
              setCheck(undefined);
            }}
          />
        }
      />
      <Typography variant="body2">
        {t(
          'Requests use this cluster through Headlamp. No service is installed or exposed, and no credentials are stored here.'
        )}
      </Typography>
      {enabled && (
        <>
          <TextField
            label={t('Prometheus namespace')}
            value={draft.namespace}
            onChange={event => change('namespace', event.target.value)}
            required
          />
          <TextField
            label={t('Prometheus Service')}
            value={draft.service}
            onChange={event => change('service', event.target.value)}
            required
          />
          <TextField
            label={t('Service port')}
            value={draft.port}
            onChange={event => change('port', event.target.value)}
            helperText={t('Use a port number or the name of a Service port.')}
            required
          />
          <TextField
            label={t('Base path')}
            value={draft.basePath}
            onChange={event => change('basePath', event.target.value)}
            helperText={t('Optional path such as /prometheus. Do not enter a URL or credentials.')}
          />
        </>
      )}
      <FormControlLabel
        label={t('Override application and version labels')}
        control={
          <Switch
            checked={customLabels}
            onChange={event => {
              setCustomLabels(event.target.checked);
              setFeedback(undefined);
            }}
          />
        }
      />
      <Typography variant="body2">
        {t(
          'By default, canonical Istio labels take precedence over app.kubernetes.io labels, then app and version. Overrides replace this fallback order.'
        )}
      </Typography>
      {customLabels && (
        <>
          <TextField
            label={t('Application label key')}
            value={labelDraft.app}
            required
            onChange={event => {
              setLabelDraft(current => ({ ...current, app: event.target.value }));
              setFeedback(undefined);
            }}
          />
          <TextField
            label={t('Version label key')}
            value={labelDraft.version}
            required
            onChange={event => {
              setLabelDraft(current => ({ ...current, version: event.target.value }));
              setFeedback(undefined);
            }}
          />
        </>
      )}
      {validation && (
        <Alert severity="warning">
          {t('Invalid settings: {{message}}', { message: validation })}
        </Alert>
      )}
      <Stack direction="row" spacing={1}>
        <Button variant="contained" disabled={!!validation} onClick={save}>
          {t('Save cluster settings')}
        </Button>
        <Button
          variant="outlined"
          disabled={!enabled || !!endpointValidation}
          onClick={() => {
            if (endpoint) {
              setCheck(current => ({ endpoint, attempt: (current?.attempt ?? 0) + 1 }));
            }
          }}
        >
          {t('Check connection')}
        </Button>
      </Stack>
      {feedback && (
        <Alert severity={feedback.error ? 'error' : 'success'}>{feedback.message}</Alert>
      )}
      {check && <ConnectionCheck key={check.attempt} cluster={cluster} endpoint={check.endpoint} />}
    </Stack>
  );
}

export default function Settings() {
  const { t } = useTranslation();
  const clusters = K8s.useClustersConf();
  const selected = K8s.useSelectedClusters();
  const [cluster, setCluster] = useState(selected.length === 1 ? selected[0] : '');
  const [resetOpen, setResetOpen] = useState(false);
  const state = useKialiConfig();
  const names = Object.keys(clusters ?? {}).sort();
  const activeCluster = names.includes(cluster) ? cluster : '';

  return (
    <SectionBox title={t('Kiali settings')} headerProps={{ headerStyle: 'main' }}>
      <Stack spacing={2} sx={{ maxWidth: 640 }}>
        <Typography>
          {t(
            'Settings are per cluster and saved in this browser profile. They are not synchronized.'
          )}
        </Typography>
        {state.valid === false ? (
          <>
            <Alert severity="error">
              {t('Stored Kiali configuration is invalid: {{message}}', { message: state.message })}
            </Alert>
            <Button variant="outlined" color="error" onClick={() => setResetOpen(true)}>
              {t('Reset Kiali settings')}
            </Button>
            <ConfirmDialog
              open={resetOpen}
              title={t('Reset Kiali settings')}
              description={t(
                'This removes Kiali settings for all clusters in this browser profile.'
              )}
              confirmLabel={t('Reset')}
              handleClose={() => setResetOpen(false)}
              onConfirm={() => {
                configStore.set({ schemaVersion: 1, clusters: {} });
                setResetOpen(false);
              }}
            />
          </>
        ) : (
          <>
            <TextField
              select
              label={t('Cluster')}
              value={activeCluster}
              onChange={event => setCluster(event.target.value)}
            >
              <MenuItem value="">{t('Select a cluster')}</MenuItem>
              {names.map(name => (
                <MenuItem key={name} value={name}>
                  {name}
                </MenuItem>
              ))}
            </TextField>
            {activeCluster ? (
              <ClusterSettingsForm
                key={activeCluster}
                cluster={activeCluster}
                initialEndpoint={getClusterConfig(state.config, activeCluster).prometheus}
                initialLabels={getClusterConfig(state.config, activeCluster).appLabels}
              />
            ) : (
              <Alert severity="info">{t('Select a cluster before editing its settings.')}</Alert>
            )}
          </>
        )}
      </Stack>
    </SectionBox>
  );
}
