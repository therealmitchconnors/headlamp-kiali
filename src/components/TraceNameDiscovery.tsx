import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useId, useState } from 'react';
import { TracingConfig, validateTracingConfig } from '../core/config';
import { clusterScope } from '../core/scope';
import { TraceNameQuery, traceNamesPath } from '../core/traceNames';
import { TraceWindow } from '../core/tracing';
import { discoverTraceNames } from '../data/tracing';
import { useRequest } from '../hooks/useRequest';
import RequestStatus from './RequestStatus';

interface CapturedLookup {
  config: TracingConfig;
  query: TraceNameQuery;
}
function Names({
  cluster,
  lookup,
  onSelect,
}: {
  cluster: string;
  lookup: CapturedLookup;
  onSelect: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const load = useCallback(
    (signal: AbortSignal) =>
      discoverTraceNames(clusterScope(cluster), lookup.config, lookup.query, signal),
    [cluster, lookup]
  );
  const state = useRequest(JSON.stringify([cluster, lookup]), load);
  return (
    <RequestStatus state={state} loadingLabel={t('Loading tracing names...')}>
      {names => (
        <Stack spacing={2}>
          <TextField
            label={t('Filter returned tracing names')}
            value={filter}
            onChange={event => setFilter(event.target.value)}
          />
          <SimpleTable
            data={names
              .filter(name => name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
              .map(name => ({ name }))}
            emptyMessage={t(
              'No matching names were returned. You can still enter a name manually.'
            )}
            columns={[
              {
                label: t('Backend-reported name'),
                getter: ({ name }: { name: string }) => (
                  <Button
                    aria-label={t('Use tracing name {{name}}', { name })}
                    onClick={() => onSelect(name)}
                  >
                    <Box sx={{ overflowWrap: 'anywhere', whiteSpace: 'normal' }}>{name}</Box>
                  </Button>
                ),
              },
            ]}
          />
        </Stack>
      )}
    </RequestStatus>
  );
}

export default function TraceNameDiscovery({
  cluster,
  config,
  service,
  getWindow,
  onService,
  onOperation,
}: {
  cluster: string;
  config: TracingConfig;
  service: string;
  getWindow: () => TraceWindow;
  onService: (value: string) => void;
  onOperation: (value: string) => void;
}) {
  const { t } = useTranslation();
  const titleId = `kiali-trace-names-${useId()}`;
  const [lookup, setLookup] = useState<CapturedLookup>();
  const [error, setError] = useState('');
  function open(kind: TraceNameQuery['kind']) {
    try {
      const query: TraceNameQuery =
        kind === 'services' ? { ...getWindow(), kind } : { ...getWindow(), kind, service };
      const captured = validateTracingConfig(config);
      traceNamesPath(captured.provider, query);
      setLookup({ config: captured, query });
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : t('Unable to discover tracing names'));
    }
  }
  return (
    <>
      <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap">
        <Button onClick={() => open('services')}>{t('Browse tracing services')}</Button>
        <Button disabled={!service.trim()} onClick={() => open('operations')}>
          {t('Browse tracing operations')}
        </Button>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      <Dialog
        open={!!lookup}
        onClose={() => setLookup(undefined)}
        aria-labelledby={titleId}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle id={titleId}>
          {lookup?.query.kind === 'operations' ? t('Tracing operations') : t('Tracing services')}
        </DialogTitle>
        <DialogContent>
          {lookup && (
            <Stack spacing={2}>
              <Alert severity="info">
                {t(
                  'These are backend-reported suggestions, not Kubernetes identities or a complete inventory. Discovery stops after 15 seconds and accepts at most 1,000 entries. Manual entry remains available.'
                )}
              </Alert>
              <Typography>
                {lookup.config.provider === 'jaeger'
                  ? t('Jaeger name lists are not constrained by the selected search time range.')
                  : t('Captured name-discovery window: {{start}} to {{end}}', {
                      start: new Date(lookup.query.start * 1000).toLocaleString(),
                      end: new Date(lookup.query.end * 1000).toLocaleString(),
                    })}
              </Typography>
              {lookup.query.kind === 'operations' && (
                <Typography sx={{ overflowWrap: 'anywhere' }}>
                  {t('Requested tracing service: {{service}}', { service: lookup.query.service })}
                </Typography>
              )}
              <Names
                cluster={cluster}
                lookup={lookup}
                onSelect={name => {
                  if (lookup.query.kind === 'services') onService(name);
                  else onOperation(name);
                  setLookup(undefined);
                }}
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLookup(undefined)}>{t('Close tracing names')}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
