import { K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';
import { useKialiConfig } from '../config';
import {
  ClusterComparisonQuery,
  planClusterComparison,
} from '../core/clusterComparison';
import { getClusterConfig } from '../core/config';
import { loadClusterComparison } from '../data/clusterComparison';
import { ReadFailure } from '../data/requests';
import { useRequest } from '../hooks/useRequest';
import RequestStatus from './RequestStatus';

function ComparisonResults({ query }: { query: ClusterComparisonQuery }) {
  const { t } = useTranslation();
  const load = useCallback((signal: AbortSignal) => loadClusterComparison(query, signal), [query]);
  const state = useRequest(JSON.stringify(query), load);
  const end = new Date(query.end * 1000).toISOString();
  const start = new Date(query.start * 1000).toISOString();
  const failure = (error: ReadFailure) => {
    const labels = {
      'not-found': t('Not found'),
      forbidden: t('Forbidden'),
      unauthenticated: t('Unauthenticated'),
      unavailable: t('Unavailable'),
      'invalid-response': t('Invalid response'),
    };
    return `${labels[error.kind]}: ${error.message}`;
  };
  return (
    <RequestStatus state={state} loadingLabel={t('Comparing cluster observations...')}>
      {snapshot => (
        <SectionBox title={t('Captured cluster comparison')}>
          <Stack spacing={2}>
            <Typography>
              {t(
                'Namespace {{namespace}}; five-minute destination-reporter rates from {{start}} to {{end}} at one-minute intervals.',
                {
                  namespace: query.namespace,
                  start,
                  end,
                }
              )}
            </Typography>
            <div id="kiali-cluster-comparison">
              <SimpleTable
                data={snapshot.clusters}
                columns={[
                  {
                    label: t('Headlamp cluster'),
                    getter: item => (
                      <Link params={{ cluster: item.target.cluster }} routeName="kiali-overview">
                        {item.target.cluster}
                      </Link>
                    ),
                  },
                  {
                    label: t('Logical mesh cluster'),
                    getter: item => item.target.meshClusterName ?? t('Not mapped'),
                  },
                  {
                    label: t('Istio API observation'),
                    getter: item =>
                      item.istio.status === 'ready'
                        ? item.istio.value.versions.join(', ')
                        : item.istio.status === 'error'
                        ? failure(item.istio.error)
                        : t('Unavailable'),
                  },
                  {
                    label: t('Namespace observation'),
                    getter: item =>
                      item.namespace.status === 'ready'
                        ? t('Observed UID: {{uid}}', { uid: item.namespace.value.uid })
                        : item.namespace.status === 'error'
                        ? failure(item.namespace.error)
                        : t('Unavailable'),
                  },
                  {
                    label: t('Telemetry store'),
                    getter: item =>
                      item.target.telemetryStore
                        ? t('Shared: {{identity}}', { identity: item.target.telemetryStore })
                        : t('Context isolated'),
                  },
                  {
                    label: t('Metric cluster identity'),
                    getter: item => item.target.telemetryCluster ?? t('Not configured'),
                  },
                  {
                    label: t('Prometheus Service'),
                    getter: item =>
                      item.target.endpoint
                        ? `${item.target.endpoint.namespace}/${item.target.endpoint.service}:${item.target.endpoint.port}${item.target.endpoint.basePath}`
                        : t('Not configured'),
                  },
                  {
                    label: t('Observed requests / second'),
                    getter: item =>
                      item.metrics.status === 'not-configured'
                        ? t('Endpoint and metric identity required')
                        : item.metrics.status === 'error'
                        ? failure(item.metrics.error)
                        : item.metrics.value.points.at(-1)?.requests?.toPrecision(5) ??
                          t('No usable samples'),
                  },
                  {
                    label: t('Observed error percentage'),
                    getter: item =>
                      item.metrics.status === 'ready'
                        ? item.metrics.value.points
                            .at(-1)
                            ?.errorPercent?.toFixed(2) ?? t('Not available')
                        : t('Not available'),
                  },
                  {
                    label: t('Provider warnings'),
                    getter: item =>
                      item.metrics.status === 'ready'
                        ? item.metrics.value.warnings.join('; ') || '-'
                        : '-',
                  },
                ]}
              />
            </div>
            <Typography variant="h6">{t('Normalized telemetry stores')}</Typography>
            <SimpleTable
              data={snapshot.stores}
              columns={[
                {
                  label: t('Telemetry store'),
                  getter: store =>
                    store.kind === 'shared'
                      ? t('Shared: {{identity}}', { identity: store.identity })
                      : t('Context isolated: {{identity}}', { identity: store.identity }),
                },
                {
                  label: t('Source contexts'),
                  getter: store =>
                    store.sourceMappings
                      .map(
                        source =>
                          `${source.cluster} (${source.telemetryCluster ?? t('Not configured')})`
                      )
                      .join(', '),
                },
                {
                  label: t('Normalization'),
                  getter: store =>
                    store.status === 'ready'
                      ? t('Complete')
                      : store.status === 'ambiguous'
                      ? t('Ambiguous: {{reason}}', { reason: store.reason ?? '' })
                      : t('Incomplete: {{reason}}', { reason: store.reason ?? '' }),
                },
                {
                  label: t('Normalized requests / second'),
                  getter: store =>
                    store.status === 'ready'
                      ? store.points.at(-1)?.requests?.toPrecision(5) ?? t('No usable samples')
                      : t('Not available'),
                },
                {
                  label: t('Normalized error percentage'),
                  getter: store =>
                    store.status === 'ready'
                      ? store.points.at(-1)?.errorPercent?.toFixed(2) ?? t('Not available')
                      : t('Not available'),
                },
                {
                  label: t('Duplicate contexts excluded'),
                  getter: store => store.duplicates.map(item => item.cluster).join(', ') || '-',
                },
              ]}
            />
          </Stack>
        </SectionBox>
      )}
    </RequestStatus>
  );
}

export default function ClusterComparison() {
  const { t } = useTranslation();
  const available = K8s.useClustersConf();
  const selected = K8s.useSelectedClusters();
  const config = useKialiConfig();
  const names = Object.keys(available ?? {}).sort();
  const [clusters, setClusters] = useState<string[]>(() =>
    selected.filter(name => names.includes(name))
  );
  const [namespace, setNamespace] = useState('');
  const [rangeMinutes, setRangeMinutes] = useState(60);
  const [rangeEnd, setRangeEnd] = useState(() =>
    new Date(Math.floor(Date.now() / 60000) * 60000).toISOString().slice(0, 16)
  );
  const [submitted, setSubmitted] = useState<{ binding: string; query: ClusterComparisonQuery }>();
  const [error, setError] = useState('');
  const binding = JSON.stringify([
    selected,
    config.valid,
    clusters.map(cluster => {
      const settings = config.valid ? getClusterConfig(config.config, cluster) : undefined;
      return [
        cluster,
        names.includes(cluster),
        settings?.prometheus,
        settings?.meshClusterName,
        settings?.telemetryCluster,
        settings?.telemetryStore,
      ];
    }),
  ]);
  useEffect(() => setSubmitted(undefined), [binding]);
  return (
    <Stack spacing={2}>
      <SectionBox title={t('Cluster comparison')} headerProps={{ headerStyle: 'main' }}>
        <Stack spacing={2}>
          <Alert severity="info">
            {t(
              'Select up to eight Headlamp contexts explicitly. Reads use each context, its saved endpoint and metric identity, and an optional explicit shared-store identity, with at most three active targets and a 15-second deadline per target. Unmapped stores remain isolated; requests do not borrow credentials across contexts. This does not discover mesh membership or enable multi-cluster writes.'
            )}
          </Alert>
          {!names.length && (
            <Alert severity="info">{t('No Headlamp clusters are available.')}</Alert>
          )}
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {names.map(name => (
              <FormControlLabel
                key={name}
                label={name}
                control={
                  <Checkbox
                    checked={clusters.includes(name)}
                    disabled={!clusters.includes(name) && clusters.length >= 8}
                    onChange={event => {
                      setClusters(current =>
                        event.target.checked
                          ? [...current, name]
                          : current.filter(value => value !== name)
                      );
                      setSubmitted(undefined);
                    }}
                  />
                }
              />
            ))}
          </Stack>
          {clusters.some(cluster => !names.includes(cluster)) && (
            <Alert severity="warning">
              {t(
                'A selected cluster is no longer available. Clear the selection and choose available contexts.'
              )}
            </Alert>
          )}
          <Button
            onClick={() => {
              setClusters([]);
              setSubmitted(undefined);
            }}
          >
            {t('Clear cluster selection')}
          </Button>
          <TextField
            label={t('Namespace')}
            value={namespace}
            onChange={event => {
              setNamespace(event.target.value);
              setSubmitted(undefined);
            }}
          />
          <TextField
            label={t('Range duration (minutes)')}
            type="number"
            inputProps={{ min: 15, max: 240, step: 15 }}
            value={rangeMinutes}
            onChange={event => {
              setRangeMinutes(Number(event.target.value));
              setSubmitted(undefined);
            }}
          />
          <TextField
            label={t('Range end (UTC)')}
            type="datetime-local"
            value={rangeEnd}
            onChange={event => {
              setRangeEnd(event.target.value);
              setSubmitted(undefined);
            }}
          />
          <Typography>
            {t(
              'Rates are sampled once per minute over the selected historical range, using five-minute Prometheus rate windows. Shared-store values collapse only when the explicit store and metric identities match and their samples are identical. Endpoint aliases or conflicting readings remain ambiguous; partial sources never produce a complete normalized total.'
            )}
          </Typography>
          <Button
            variant="contained"
            disabled={!config.valid || !clusters.length}
            onClick={() => {
              if (config.valid === false) return;
              try {
                const parsedEnd = Date.parse(`${rangeEnd}:00Z`);
                if (!Number.isFinite(parsedEnd)) throw new Error(t('Choose a valid UTC range end'));
                const end = Math.floor(parsedEnd / 1000);
                const query = planClusterComparison(
                  clusters,
                  names,
                  config.config,
                  namespace,
                  end - rangeMinutes * 60,
                  end
                );
                setSubmitted({ binding, query });
                setError('');
              } catch (error) {
                setSubmitted(undefined);
                setError(error instanceof Error ? error.message : t('Invalid cluster comparison'));
              }
            }}
          >
            {t('Compare clusters')}
          </Button>
          {error && <Alert severity="error">{error}</Alert>}
          {config.valid === false && <Alert severity="error">{config.message}</Alert>}
          <Link routeName="kiali-settings">{t('Connection settings')}</Link>
        </Stack>
      </SectionBox>
      {submitted?.binding === binding && <ComparisonResults query={submitted.query} />}
    </Stack>
  );
}
