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
  TracingConfig,
  validateAppLabels,
  validateIdentityDomain,
  validateServiceEndpoint,
  validateTelemetryCluster,
  validateTracingConfig,
} from '../core/config';
import { CustomDashboardSettings, validateCustomDashboardSettings } from '../core/customDashboards';
import { GatewayClassSettings, validateGatewayClassSettings } from '../core/gatewayClassRegistry';
import { HealthRateRule, validateHealthRules } from '../core/healthCalculator';
import { AppLabels } from '../core/labels';
import { clusterScope } from '../core/scope';
import { inspectPrometheus } from '../data/requests';
import { inspectTracing } from '../data/tracing';
import { useRequest } from '../hooks/useRequest';
import RequestStatus from './RequestStatus';

const EMPTY_ENDPOINT: ServiceEndpoint = { namespace: '', service: '', port: '9090', basePath: '' };

function TracingCheck({ cluster, config }: { cluster: string; config: TracingConfig }) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) => inspectTracing(clusterScope(cluster), config, signal),
    [cluster, config]
  );
  const result = useRequest(JSON.stringify([cluster, config]), load);
  return (
    <RequestStatus state={result}>
      {() => (
        <Alert severity="success">
          {t(
            'The tracing query API responded. Search and trace access may require additional backend permissions.'
          )}
        </Alert>
      )}
    </RequestStatus>
  );
}

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
  initialHealthRates,
  initialIdentityDomain,
  initialTracing,
  initialGatewayClasses,
  initialTelemetryCluster,
  initialSkipWildcardGatewayHosts,
  initialCustomDashboards,
}: {
  cluster: string;
  initialEndpoint: ServiceEndpoint | null;
  initialLabels?: AppLabels | null;
  initialHealthRates?: HealthRateRule[];
  initialIdentityDomain?: string | null;
  initialTracing?: TracingConfig | null;
  initialGatewayClasses?: GatewayClassSettings;
  initialTelemetryCluster?: string | null;
  initialSkipWildcardGatewayHosts?: boolean;
  initialCustomDashboards?: CustomDashboardSettings;
}) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(initialEndpoint !== null);
  const [draft, setDraft] = useState(initialEndpoint ?? EMPTY_ENDPOINT);
  const [customLabels, setCustomLabels] = useState(!!initialLabels);
  const [labelDraft, setLabelDraft] = useState(initialLabels ?? { app: 'app', version: 'version' });
  const [healthText, setHealthText] = useState(JSON.stringify(initialHealthRates ?? [], null, 2));
  const [gatewayText, setGatewayText] = useState(
    JSON.stringify(initialGatewayClasses ?? { classes: [], selector: {} }, null, 2)
  );
  const [domainDraft, setDomainDraft] = useState(initialIdentityDomain ?? '');
  const [metricIdentity, setMetricIdentity] = useState(initialTelemetryCluster ?? '');
  const [dashboardText, setDashboardText] = useState(
    JSON.stringify(
      initialCustomDashboards ?? {
        namespaceLabel: 'namespace',
        clusterLabel: 'cluster',
        dashboards: [],
      },
      null,
      2
    )
  );
  const [skipWildcardGatewayHosts, setSkipWildcardGatewayHosts] = useState(
    initialSkipWildcardGatewayHosts ?? false
  );
  const [tracingEnabled, setTracingEnabled] = useState(!!initialTracing);
  const [tracingProvider, setTracingProvider] = useState<TracingConfig['provider']>(
    initialTracing?.provider ?? 'jaeger'
  );
  const [tracingEndpoint, setTracingEndpoint] = useState<ServiceEndpoint>(
    initialTracing?.endpoint ?? { namespace: '', service: '', port: '16686', basePath: '' }
  );
  const [feedback, setFeedback] = useState<{ error: boolean; message: string }>();
  const [check, setCheck] = useState<{ endpoint: ServiceEndpoint; attempt: number }>();
  const [tracingCheck, setTracingCheck] = useState<{ config: TracingConfig; attempt: number }>();
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
  let healthRates: HealthRateRule[] = [];
  let healthValidation: string | undefined;
  try {
    healthRates = validateHealthRules(JSON.parse(healthText));
  } catch (error) {
    healthValidation = error instanceof Error ? error.message : t('Invalid health rules');
  }
  let identityDomain: string | null = null;
  let domainValidation: string | undefined;
  if (domainDraft) {
    try {
      identityDomain = validateIdentityDomain(domainDraft);
    } catch (error) {
      if (!(error instanceof ConfigurationError)) throw error;
      domainValidation = error.message;
    }
  }
  let tracing: TracingConfig | null = null;
  let tracingValidation: string | undefined;
  if (tracingEnabled) {
    try {
      tracing = validateTracingConfig({ provider: tracingProvider, endpoint: tracingEndpoint });
    } catch (error) {
      if (!(error instanceof ConfigurationError)) throw error;
      tracingValidation = error.message;
    }
  }
  let gatewayClasses: GatewayClassSettings | undefined;
  let gatewayValidation: string | undefined;
  try {
    gatewayClasses = validateGatewayClassSettings(JSON.parse(gatewayText));
  } catch (error) {
    gatewayValidation =
      error instanceof Error ? error.message : t('Invalid Gateway class settings');
  }
  let telemetryCluster: string | null = null;
  let telemetryValidation: string | undefined;
  if (metricIdentity) {
    try {
      telemetryCluster = validateTelemetryCluster(metricIdentity);
    } catch (error) {
      telemetryValidation =
        error instanceof Error ? error.message : t('Invalid metric cluster label');
    }
  }
  let customDashboards: CustomDashboardSettings | undefined;
  let dashboardValidation: string | undefined;
  try {
    customDashboards = validateCustomDashboardSettings(JSON.parse(dashboardText));
  } catch (error) {
    dashboardValidation =
      error instanceof Error ? error.message : t('Invalid custom dashboard definitions');
  }
  const validation =
    endpointValidation ??
    labelValidation ??
    healthValidation ??
    domainValidation ??
    tracingValidation ??
    gatewayValidation ??
    telemetryValidation ??
    dashboardValidation;

  function change(field: keyof ServiceEndpoint, value: string) {
    setDraft(current => ({ ...current, [field]: value }));
    setFeedback(undefined);
    setCheck(undefined);
  }
  function changeTracing(field: keyof ServiceEndpoint, value: string) {
    setTracingEndpoint(current => ({ ...current, [field]: value }));
    setFeedback(undefined);
    setTracingCheck(undefined);
  }

  function save() {
    if (validation) {
      setFeedback({ error: true, message: validation });
      return;
    }
    try {
      saveClusterConfig(cluster, {
        prometheus: endpoint,
        appLabels,
        healthRates,
        identityDomain,
        tracing,
        customDashboards:
          initialCustomDashboards === undefined &&
          customDashboards?.dashboards.length === 0 &&
          customDashboards.includeBuiltins !== true &&
          customDashboards.discoveryMode === undefined &&
          customDashboards.discoveryAutoThreshold === undefined &&
          customDashboards.namespaceLabel === 'namespace' &&
          customDashboards.clusterLabel === 'cluster'
            ? undefined
            : customDashboards,
        skipWildcardGatewayHosts:
          initialSkipWildcardGatewayHosts === undefined && !skipWildcardGatewayHosts
            ? undefined
            : skipWildcardGatewayHosts,
        telemetryCluster:
          initialTelemetryCluster === undefined && telemetryCluster === null
            ? undefined
            : telemetryCluster,
        gatewayClasses:
          initialGatewayClasses === undefined &&
          gatewayClasses &&
          !gatewayClasses.classes.length &&
          !Object.keys(gatewayClasses.selector).length
            ? undefined
            : gatewayClasses,
      });
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
      <FormControlLabel
        label={t('Connect to an existing tracing Service')}
        control={
          <Switch
            checked={tracingEnabled}
            onChange={event => {
              setTracingEnabled(event.target.checked);
              setTracingCheck(undefined);
              setFeedback(undefined);
            }}
          />
        }
      />
      {tracingEnabled && (
        <>
          <TextField
            select
            label={t('Tracing provider')}
            value={tracingProvider}
            onChange={event => {
              if (event.target.value === 'jaeger' || event.target.value === 'tempo')
                setTracingProvider(event.target.value);
              setFeedback(undefined);
              setTracingCheck(undefined);
            }}
          >
            <MenuItem value="jaeger">Jaeger</MenuItem>
            <MenuItem value="tempo">Tempo</MenuItem>
          </TextField>
          <TextField
            label={t('Tracing namespace')}
            value={tracingEndpoint.namespace}
            required
            onChange={event => {
              changeTracing('namespace', event.target.value);
            }}
          />
          <TextField
            label={t('Tracing Service')}
            value={tracingEndpoint.service}
            required
            onChange={event => {
              changeTracing('service', event.target.value);
            }}
          />
          <TextField
            label={t('Tracing Service port')}
            value={tracingEndpoint.port}
            required
            onChange={event => {
              changeTracing('port', event.target.value);
            }}
            helperText={t(
              'Use the HTTP query port, commonly 16686 for Jaeger or 3200 for Tempo, not a gRPC or ingestion port.'
            )}
          />
          <TextField
            label={t('Tracing base path')}
            value={tracingEndpoint.basePath}
            onChange={event => {
              changeTracing('basePath', event.target.value);
            }}
            helperText={t(
              'Optional plain path prefix. External URLs, credentials and tenant headers are not stored.'
            )}
          />
        </>
      )}
      <TextField
        label={t('Service DNS identity domain')}
        value={domainDraft}
        onChange={event => {
          setDomainDraft(event.target.value);
          setFeedback(undefined);
        }}
        helperText={t(
          'Optional explicit suffix such as svc.cluster.local for cross-resource host checks. This is not a Headlamp or telemetry cluster name. Leave blank when unknown.'
        )}
      />
      <TextField
        label={t('Custom health rules (JSON)')}
        multiline
        minRows={4}
        maxRows={12}
        value={healthText}
        onChange={event => {
          setHealthText(event.target.value);
          setFeedback(undefined);
        }}
        helperText={t(
          'Rules match namespace, kind and name in order. Supply tolerance entries with code, degraded, failure, protocol and direction. Kiali defaults are appended after these custom rules. Patterns use linear-time RE2 syntax.'
        )}
      />
      <TextField
        label={t('Default Istio metric cluster label')}
        value={metricIdentity}
        onChange={event => {
          setMetricIdentity(event.target.value);
          setFeedback(undefined);
        }}
        helperText={t(
          'Optional exact source_cluster/destination_cluster label used by this cluster in Istio telemetry. It is not inferred from the Headlamp context or Service DNS suffix. Metrics, health and graph forms use it as an editable default. Changing it or the Prometheus endpoint discards submitted queries and local identity overrides; load again explicitly.'
        )}
      />
      <TextField
        label={t('Gateway API class registry (JSON)')}
        multiline
        minRows={4}
        maxRows={12}
        value={gatewayText}
        onChange={event => {
          setGatewayText(event.target.value);
          setFeedback(undefined);
        }}
        helperText={t(
          'Provide classes as name/className entries, or leave classes empty to discover them. selector is an equality-label map; a nonempty selector permits matching controllers beyond Istio. These browser-local settings do not install GatewayClasses or change permissions.'
        )}
      />
      <FormControlLabel
        label={t('Skip bare wildcard hosts in Istio Gateway conflict checks')}
        control={
          <Switch
            checked={skipWildcardGatewayHosts}
            onChange={event => {
              setSkipWildcardGatewayHosts(event.target.checked);
              setFeedback(undefined);
            }}
          />
        }
      />
      <Typography variant="body2">
        {t(
          'Default off, matching pinned Kiali. This skips comparisons involving a bare * host, not *.example.com patterns. It affects local KIA0301 checks only, not Gateway API checks or cluster configuration.'
        )}
      </Typography>
      <FormControlLabel
        label={t('Include the bundled Kiali dashboard catalog')}
        control={
          <Switch
            checked={customDashboards?.includeBuiltins === true}
            disabled={!!dashboardValidation}
            onChange={event => {
              if (!customDashboards) {
                setFeedback({
                  error: true,
                  message: t('Correct dashboard JSON before changing the bundled catalog'),
                });
                return;
              }
              setDashboardText(
                JSON.stringify(
                  { ...customDashboards, includeBuiltins: event.target.checked },
                  null,
                  2
                )
              );
              setFeedback(undefined);
            }}
          />
        }
      />
      <Typography variant="body2">
        {t(
          'Opt-in per cluster. The plugin bundles 21 Kiali v2.33.0 templates; no cluster installation or remote template fetch is needed. Your saved definitions override matching bundled names. Namespace and metric-cluster selectors remain explicit.'
        )}
      </Typography>
      <TextField
        label={t('Custom aggregate dashboards (JSON)')}
        multiline
        minRows={4}
        maxRows={12}
        value={dashboardText}
        onChange={event => {
          setDashboardText(event.target.value);
          setFeedback(undefined);
        }}
        inputProps={{ maxLength: 131072 }}
        helperText={t(
          'Use namespaceLabel, clusterLabel, dashboards and optional includeBuiltins. Templates have name, title, optional runtime/discoverOn and 1 to 8 chart/include items. Includes use template or template$Chart name and retain literal text for discovery; composition trims them. Charts support name, dataType (raw/rate/histogram), optional unit, aggregator, unitScale, integer min/max display bounds and spans (1..12 columns). Supply metrics with metricName/displayName or a legacy metricName. Missing units remain unspecified; bounds never clamp numeric values. Fixed groupLabels and optional aggregations declarations ({label,displayName,singleSelection}) control grouping. Optional grouping is submitted on explicit load; returned values can then be hidden locally, without refetching. Combined grouping is limited to four distinct labels and 256 total name characters; __name__ and histogram le are excluded. Expanded queries, grouped responses and visible panels have separate eight-item limits. Background app discovery and external links remain unsupported. Set clusterLabel to null only for an explicitly acknowledged single-cluster source. Settings are browser-local, not Kubernetes changes.'
        )}
      />
      <Typography variant="body2">
        {t(
          'Application inspection accepts optional discoveryMode ("auto", "enabled" or "disabled", default "auto") and discoveryAutoThreshold (integer 0..1000, default 10). These govern metric-name fallback only after an explicit inspection with no resolved Pod references. Auto skips applications above the observed Pod threshold; enabled bypasses it; disabled still allows explicit references. Namespace annotation reads remain required. This does not start background queries.'
        )}
      </Typography>
      <Typography variant="body2">
        {t(
          'Charts accept sortLabel and optional sortLabelParseAs: "int". Ordering is lexical by default or exact signed 64-bit integer order. A sort label not already grouped is added to the query and hidden from displayed groups, within the existing four-label limit. Invalid integer values or indistinguishable groups after hiding the label fail explicitly; include the label in groupLabels to retain it. Sorting never merges series.'
        )}
      </Typography>
      <Typography variant="body2">
        {t(
          'Optional chartType selects line, area, bar or scatter (points) for the existing time axis. Missing/null/empty uses line. Series remain independent, never stacked or summed for display; missing samples are not zero. Units, numeric tables, grouping, sorting, bounds and expansion retain the captured data. Other axis modes remain unsupported.'
        )}
      </Typography>
      <Typography variant="body2">
        {t(
          'To disable a template by name, save a declaration such as {"name":"go","items":[]} with no discoverOn metric. This removes that name from the effective catalog, not from Kubernetes. A nonempty discoverOn with no items remains discovery-only and cannot load charts. Remove or replace the declaration to restore the template.'
        )}
      </Typography>
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
      {tracingEnabled && (
        <Typography variant="body2">
          {t(
            'Tracing connection checks stop after 15 seconds. A response does not establish search or trace-read permissions.'
          )}
        </Typography>
      )}
      {tracingEnabled && (
        <Button
          disabled={!!tracingValidation}
          onClick={() => {
            if (tracing)
              setTracingCheck(current => ({
                config: tracing,
                attempt: (current?.attempt ?? 0) + 1,
              }));
          }}
        >
          {t('Check tracing connection')}
        </Button>
      )}
      {tracingCheck && (
        <TracingCheck key={tracingCheck.attempt} cluster={cluster} config={tracingCheck.config} />
      )}
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
                initialCustomDashboards={
                  getClusterConfig(state.config, activeCluster).customDashboards
                }
                initialLabels={getClusterConfig(state.config, activeCluster).appLabels}
                initialHealthRates={getClusterConfig(state.config, activeCluster).healthRates}
                initialIdentityDomain={getClusterConfig(state.config, activeCluster).identityDomain}
                initialSkipWildcardGatewayHosts={
                  getClusterConfig(state.config, activeCluster).skipWildcardGatewayHosts
                }
                initialTracing={getClusterConfig(state.config, activeCluster).tracing}
                initialGatewayClasses={getClusterConfig(state.config, activeCluster).gatewayClasses}
                initialTelemetryCluster={
                  getClusterConfig(state.config, activeCluster).telemetryCluster
                }
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
