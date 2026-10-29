import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback, useState } from 'react';
import type { Labels } from '../../core/labels';
import { NamespaceScope, namespaceScope } from '../../core/scope';
import { workloadGroupEntrySelector } from '../../core/workloadGroupEntries';
import { loadWorkloadGroupEntries } from '../../data/workloadGroupEntries';
import { useRequest } from '../../hooks/useRequest';
import { ConfigurationResource } from '../../resources/common';
import { WorkloadEntry } from '../../resources/workload-entry';
import RequestStatus from '../RequestStatus';
import WorkloadEntryHealth from '../WorkloadEntryHealth';
import StructuredValue from './StructuredValue';

interface Query {
  scope: NamespaceScope;
  selector: Labels;
  attempt: number;
}
function Matches({ query }: { query: Query }) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) => loadWorkloadGroupEntries(query.scope, query.selector, signal),
    [query]
  );
  const state = useRequest(JSON.stringify(query), load);
  const text = (value: string | undefined) =>
    value === undefined ? t('Not reported') : value === '' ? t('Empty') : value;
  return (
    <RequestStatus state={state} loadingLabel={t('Loading matching WorkloadEntries...')}>
      {data => (
        <Stack spacing={1}>
          <Typography>
            {t('Cluster {{cluster}}; namespace {{namespace}}; {{count}} entries examined.', {
              cluster: data.scope.cluster,
              namespace: data.scope.namespace,
              count: data.examined,
            })}
          </Typography>
          {!data.complete && (
            <Alert severity="warning">
              {t('WorkloadEntry inventory is incomplete: {{reason}}', {
                reason: data.error?.message ?? t('The four-page limit was reached'),
              })}
            </Alert>
          )}
          <details>
            <summary>{t('Captured WorkloadGroup labels')}</summary>
            <StructuredValue value={data.selector} />
          </details>
          <Alert severity="info">
            {t(
              'Probe evidence follows pinned Kiali: disabled or unrecognized health-check annotations assume availability; enabled checks use the first Healthy condition and default to unavailable when it is missing or unknown. These are reported conditions or explicit assumptions, not a live VM probe, fresh-status guarantee or permission to infer Pod/replica health.'
            )}
          </Alert>
          <SimpleTable
            data={data.items}
            emptyMessage={
              data.complete
                ? t('No WorkloadEntries matched the captured group labels.')
                : t('No matches in the returned pages; the inventory is incomplete.')
            }
            columns={[
              {
                label: t('Name'),
                getter: item => (
                  <Link
                    routeName={WorkloadEntry.detailsRoute}
                    params={{
                      cluster: data.scope.cluster,
                      namespace: item.namespace,
                      name: item.name,
                    }}
                  >
                    {item.name}
                  </Link>
                ),
              },
              {
                label: t('Address'),
                getter: item => <Box sx={{ overflowWrap: 'anywhere' }}>{text(item.address)}</Box>,
              },
              { label: t('Network'), getter: item => text(item.network) },
              { label: t('Service account'), getter: item => text(item.serviceAccount) },
              {
                label: t('Probe evidence'),
                getter: item => <WorkloadEntryHealth health={item.health} />,
              },
              {
                label: t('Observed UID'),
                getter: item => <Box sx={{ overflowWrap: 'anywhere' }}>{item.uid}</Box>,
              },
            ]}
          />
        </Stack>
      )}
    </RequestStatus>
  );
}

export default function WorkloadGroupEntries({ resource }: { resource: ConfigurationResource }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState<Query>();
  const [error, setError] = useState('');
  let selector: Labels | null = null;
  let selectorError = '';
  try {
    selector = workloadGroupEntrySelector(resource.spec);
  } catch (error) {
    selectorError =
      error instanceof Error ? error.message : t('WorkloadGroup labels are unavailable');
  }
  const hasSelector = selector !== null && Object.keys(selector).length > 0;
  return (
    <SectionBox title={t('Matching WorkloadEntries')}>
      <Stack spacing={2}>
        <Alert severity="info">
          {t(
            'Matches compare WorkloadGroup spec.metadata.labels with WorkloadEntry spec.labels in the same cluster and namespace. They are not owner references or proof of connectivity, registration, proxy synchronization or VM health. Observed UIDs are shown, but navigation uses namespace and name.'
          )}
        </Alert>
        {selectorError ? (
          <Alert severity="error">{selectorError}</Alert>
        ) : (
          !hasSelector && (
            <Alert severity="info">
              {t(
                'A missing or empty group label selector matches no WorkloadEntries in the pinned Kiali behavior. No list request is sent.'
              )}
            </Alert>
          )
        )}
        <Button
          disabled={!hasSelector || !!selectorError}
          onClick={() => {
            try {
              if (!selector) throw new Error(t('WorkloadGroup labels are unavailable'));
              const scope = namespaceScope(resource.cluster, resource.metadata.namespace ?? '');
              const captured = structuredClone(selector);
              setQuery(current => ({
                scope,
                selector: captured,
                attempt: (current?.attempt ?? 0) + 1,
              }));
              setError('');
            } catch (error) {
              setError(
                error instanceof Error ? error.message : t('Unable to capture WorkloadGroup scope')
              );
            }
          }}
        >
          {t('Load matching WorkloadEntries')}
        </Button>
        <Typography variant="body2">
          {t(
            'The lookup stops after 15 seconds and reads at most four pages of 250 WorkloadEntries. Partial results remain explicitly incomplete.'
          )}
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {query && <Matches query={query} />}
      </Stack>
    </SectionBox>
  );
}
