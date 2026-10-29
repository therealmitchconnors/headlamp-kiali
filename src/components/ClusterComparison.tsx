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
  duplicateTelemetryIdentities,
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
  const duplicates = duplicateTelemetryIdentities(query.targets);
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
                'Namespace {{namespace}}; five-minute destination-reporter rates ending {{time}}',
                {
                  namespace: query.namespace,
                  time: new Date(query.end * 1000).toISOString(),
                }
              )}
            </Typography>
            {!!duplicates.length && (
              <Alert severity="warning">
                {t(
                  'Repeated telemetry identities: {{identities}}. They may refer to overlapping data. Results are not summed or deduplicated across providers.',
                  { identities: duplicates.join(', ') }
                )}
              </Alert>
            )}
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
                    label: t('Metric identity'),
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
                        : item.metrics.value.point?.requests?.toPrecision(5) ??
                          t('No usable samples'),
                  },
                  {
                    label: t('Observed error percentage'),
                    getter: item =>
                      item.metrics.status === 'ready'
                        ? item.metrics.value.point?.errorPercent?.toFixed(2) ?? t('Not available')
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
  const [submitted, setSubmitted] = useState<{ binding: string; query: ClusterComparisonQuery }>();
  const [error, setError] = useState('');
  const binding = JSON.stringify([
    selected,
    config.valid,
    clusters.map(cluster => {
      const settings = config.valid ? getClusterConfig(config.config, cluster) : undefined;
      return [cluster, names.includes(cluster), settings?.prometheus, settings?.telemetryCluster];
    }),
  ]);
  useEffect(() => setSubmitted(undefined), [binding]);
  return (
    <Stack spacing={2}>
      <SectionBox title={t('Cluster comparison')} headerProps={{ headerStyle: 'main' }}>
        <Stack spacing={2}>
          <Alert severity="info">
            {t(
              'Select up to eight Headlamp contexts explicitly. Reads use each context and its saved Prometheus/metric identity with at most three active targets and a 15-second deadline per target. This does not discover mesh membership, infer health, combine providers or enable multi-cluster writes. Changing selections or connection settings discards the submitted comparison.'
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
          <Typography>
            {t(
              'Unknown mappings do not produce broad metric queries. Missing namespaces, denied APIs and metric failures remain separate observations; empty metrics are not a healthy result.'
            )}
          </Typography>
          <Button
            variant="contained"
            disabled={!config.valid || !clusters.length}
            onClick={() => {
              if (config.valid === false) return;
              try {
                const query = planClusterComparison(
                  clusters,
                  names,
                  config.config,
                  namespace,
                  Math.floor(Date.now() / 1000)
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
