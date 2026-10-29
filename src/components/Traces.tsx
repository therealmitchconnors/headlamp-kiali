import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Link, SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { useKialiConfig } from '../config';
import { getClusterConfig, TracingConfig } from '../core/config';
import { clusterScope } from '../core/scope';
import { traceIntrinsicName } from '../core/traceIntrinsics';
import {
  traceDate,
  TraceDetail,
  traceId,
  traceMilliseconds,
  TraceQuery,
  traceSearchPath,
  TraceSpan,
  TraceSummary,
  TraceTagFilter,
} from '../core/tracing';
import { loadTrace, searchTraces } from '../data/tracing';
import { useRequest } from '../hooks/useRequest';
import ClusterScope from './ClusterScope';
import RequestStatus from './RequestStatus';
import TraceAttributeFilters, { AttributeFilterRow } from './TraceAttributeFilters';
import Attributes from './TraceAttributes';
import TraceIntrinsicFilters, { IntrinsicFilterRow } from './TraceIntrinsicFilters';
import { SpanMetadata, TraceReferenceMetadata } from './TraceMetadata';
import TraceNameDiscovery from './TraceNameDiscovery';
import TracePodCorrelation from './TracePodCorrelation';

function formatMilliseconds(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 6 });
}

const traceIdStyle = {
  overflowWrap: 'anywhere',
  wordBreak: 'break-all',
  whiteSpace: 'normal',
  minWidth: 0,
  maxWidth: '100%',
  fontFamily: 'monospace',
  textTransform: 'none',
} as const;

function TraceContent({
  cluster,
  trace,
  onSelectTrace,
}: {
  cluster: string;
  trace: TraceDetail;
  onSelectTrace: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string>();
  const selected = trace.spans.find(span => span.id === selectedId);
  const offset = (span: TraceSpan) =>
    Number(BigInt(span.startNs) - BigInt(trace.startNs)) / 1000000;
  const duration = traceMilliseconds(trace.durationNs);
  return (
    <Stack spacing={2}>
      <SectionBox title={t('Trace detail')}>
        <Typography>
          <code>{trace.id}</code>
        </Typography>
        <Typography>
          {traceDate(trace.startNs).toLocaleString()} - {formatMilliseconds(duration)} ms
        </Typography>
        <Typography>
          {t(
            '{{count}} spans; {{errors}} report an error. Missing error flags are not health verdicts.',
            { count: trace.spans.length, errors: trace.errorSpans ?? 0 }
          )}
        </Typography>
        {trace.warnings.map((warning, index) => (
          <Alert severity="warning" key={index}>
            {warning}
          </Alert>
        ))}
        <SimpleTable
          data={trace.spans}
          columns={[
            { label: t('Service'), getter: (span: TraceSpan) => span.service ?? t('Not reported') },
            {
              label: t('Operation'),
              getter: (span: TraceSpan) => span.operation || t('Unnamed operation'),
            },
            {
              label: t('Offset (ms)'),
              getter: (span: TraceSpan) => formatMilliseconds(offset(span)),
            },
            {
              label: t('Duration (ms)'),
              getter: (span: TraceSpan) => formatMilliseconds(traceMilliseconds(span.durationNs)),
            },
            {
              label: t('Relative timing'),
              getter: (span: TraceSpan) => (
                <Box
                  role="img"
                  aria-label={t('Span starts at {{offset}} ms and lasts {{duration}} ms', {
                    offset: formatMilliseconds(offset(span)),
                    duration: formatMilliseconds(traceMilliseconds(span.durationNs)),
                  })}
                  sx={{ width: 180, height: 14, bgcolor: 'action.hover', position: 'relative' }}
                >
                  <Box
                    sx={{
                      position: 'absolute',
                      height: '100%',
                      bgcolor: span.error === true ? 'error.main' : 'primary.main',
                      left: `${
                        duration > 0
                          ? Math.max(0, Math.min(100, (offset(span) / duration) * 100))
                          : 0
                      }%`,
                      width: `${
                        duration > 0
                          ? Math.max(
                              0,
                              Math.min(100, (traceMilliseconds(span.durationNs) / duration) * 100)
                            )
                          : 0
                      }%`,
                    }}
                  />
                </Box>
              ),
            },
            {
              label: t('Error flag'),
              getter: (span: TraceSpan) =>
                span.error === null
                  ? t('Not reported')
                  : span.error
                  ? t('Error reported')
                  : t('False'),
            },
            {
              label: t('Details'),
              getter: (span: TraceSpan) => (
                <Button
                  aria-label={t('Inspect span {{id}}', { id: span.id })}
                  onClick={() => setSelectedId(span.id)}
                >
                  {t('Inspect span')}
                </Button>
              ),
            },
          ]}
        />
      </SectionBox>
      {selected && (
        <SectionBox title={t('Selected span')}>
          <Stack spacing={2}>
            <Typography>
              {selected.operation} <code>{selected.id}</code>
            </Typography>
            <Typography>
              {t('Exact start / duration (nanoseconds)')}: {selected.startNs} /{' '}
              {selected.durationNs}
            </Typography>
            {selected.parentId && (
              <Typography>
                {t('Parent span')}:{' '}
                {trace.spans.some(span => span.id === selected.parentId) ? (
                  <Button onClick={() => setSelectedId(selected.parentId)}>
                    {selected.parentId}
                  </Button>
                ) : (
                  `${selected.parentId} (${t('Not included')})`
                )}
              </Typography>
            )}
            <Typography>
              {t('Span kind')}: {selected.kind ?? t('Not reported')}
            </Typography>
            <SpanMetadata span={selected} />
            <Typography variant="h6" component="h3">
              {t('Span attributes')}
            </Typography>
            <Attributes entries={selected.attributes} />
            <Typography variant="h6" component="h3">
              {t('Resource / process attributes')}
            </Typography>
            <Attributes entries={selected.resourceAttributes} />
            <TracePodCorrelation key={selected.id} cluster={cluster} span={selected} />
            <Typography variant="h6" component="h3">
              {t('Span events / logs')}
            </Typography>
            <SimpleTable
              data={selected.events}
              columns={[
                { label: t('Time'), getter: item => traceDate(item.timestampNs).toLocaleString() },
                { label: t('Event'), getter: item => item.name },
                {
                  label: t('Dropped event attributes'),
                  getter: item => item.droppedAttributesCount ?? t('Not reported'),
                },
                {
                  label: t('Attributes'),
                  getter: item => <Attributes entries={item.attributes} />,
                },
              ]}
            />
            <Typography variant="h6" component="h3">
              {t('Span references / links')}
            </Typography>
            <SimpleTable
              data={selected.references.map((reference, index) => ({
                ...reference,
                index: index + 1,
              }))}
              columns={[
                { label: t('Type'), getter: item => item.type },
                {
                  label: t('Trace'),
                  getter: item =>
                    item.traceId === trace.id ? (
                      <code>{item.traceId}</code>
                    ) : (
                      <Button sx={traceIdStyle} onClick={() => onSelectTrace(item.traceId)}>
                        {item.traceId}
                      </Button>
                    ),
                },
                {
                  label: t('Span'),
                  getter: item =>
                    item.traceId === trace.id &&
                    trace.spans.some(span => span.id === item.spanId) ? (
                      <Button onClick={() => setSelectedId(item.spanId)}>{item.spanId}</Button>
                    ) : (
                      item.spanId
                    ),
                },
                {
                  label: t('Metadata'),
                  getter: item => (
                    <TraceReferenceMetadata
                      key={`${selected.id}:${item.index}`}
                      reference={item}
                      index={item.index}
                    />
                  ),
                },
              ]}
            />
          </Stack>
        </SectionBox>
      )}
    </Stack>
  );
}

function Detail({
  cluster,
  config,
  id,
  onSelectTrace,
}: {
  cluster: string;
  config: TracingConfig;
  id: string;
  onSelectTrace: (id: string) => void;
}) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) => loadTrace(clusterScope(cluster), config, id, signal),
    [cluster, config, id]
  );
  const result = useRequest(JSON.stringify([cluster, config, id]), load);
  return (
    <RequestStatus state={result} loadingLabel={t('Loading trace...')}>
      {trace => (
        <TraceContent
          key={trace.id}
          cluster={cluster}
          trace={trace}
          onSelectTrace={onSelectTrace}
        />
      )}
    </RequestStatus>
  );
}
function Search({
  cluster,
  config,
  query,
  onSelectTrace,
}: {
  cluster: string;
  config: TracingConfig;
  query: TraceQuery;
  onSelectTrace: (id: string) => void;
}) {
  const { t } = useTranslation();
  const load = useCallback(
    (signal: AbortSignal) => searchTraces(clusterScope(cluster), config, query, signal),
    [cluster, config, query]
  );
  const result = useRequest(JSON.stringify([cluster, config, query]), load);
  return (
    <RequestStatus state={result} loadingLabel={t('Searching traces...')}>
      {data => (
        <SectionBox title={t('Trace search results')}>
          <Typography>
            {t('Service: {{service}}; captured range: {{start}} to {{end}}', {
              service: query.service,
              start: new Date(query.start * 1000).toLocaleString(),
              end: new Date(query.end * 1000).toLocaleString(),
            })}
          </Typography>
          <Typography>
            {t(
              'Captured filters: operation {{operation}}; minimum {{duration}} ms; reported errors only {{errors}}',
              {
                operation: query.operation || t('Any'),
                duration: query.minDurationMs ?? 0,
                errors: query.errorsOnly ? t('Yes') : t('No'),
              }
            )}
          </Typography>
          {!!query.tags?.length && (
            <details>
              <summary>{t('Show captured tag filters')}</summary>
              <SimpleTable
                data={[...query.tags]}
                columns={[
                  {
                    label: t('Tag name'),
                    getter: (filter: TraceTagFilter) => <Box sx={traceIdStyle}>{filter.key}</Box>,
                  },
                  {
                    label: t('Exact string value'),
                    getter: (filter: TraceTagFilter) => (
                      <Box sx={traceIdStyle}>{filter.value || t('Empty string')}</Box>
                    ),
                  },
                ]}
              />
            </details>
          )}
          {!!query.tempoFilters?.length && (
            <details>
              <summary>{t('Show captured attribute filters')}</summary>
              <SimpleTable
                data={[...query.tempoFilters]}
                columns={[
                  { label: t('Scope'), getter: filter => filter.scope },
                  {
                    label: t('Attribute'),
                    getter: filter => <Box sx={traceIdStyle}>{filter.key}</Box>,
                  },
                  { label: t('Type'), getter: filter => filter.type },
                  { label: t('Comparison'), getter: filter => filter.operator },
                  {
                    label: t('Value'),
                    getter: filter => (
                      <Box sx={traceIdStyle}>
                        {filter.type === 'nil'
                          ? t('Not applicable')
                          : filter.value || t('Empty string')}
                      </Box>
                    ),
                  },
                ]}
              />
            </details>
          )}
          {!!query.tempoIntrinsics?.length && (
            <details>
              <summary>{t('Show captured intrinsic filters')}</summary>
              <SimpleTable
                data={[...query.tempoIntrinsics]}
                columns={[
                  {
                    label: t('Intrinsic field'),
                    getter: filter => traceIntrinsicName(filter.field),
                  },
                  { label: t('Comparison'), getter: filter => filter.operator },
                  {
                    label: t('Value'),
                    getter: filter => (
                      <Box sx={traceIdStyle}>{filter.value || t('Empty string')}</Box>
                    ),
                  },
                ]}
              />
            </details>
          )}
          {data.warnings.map((warning, index) => (
            <Alert severity="warning" key={index}>
              {warning}
            </Alert>
          ))}
          <SimpleTable
            data={data.traces}
            emptyMessage={t(
              'No traces were returned for this search. This is not a service-health result.'
            )}
            columns={[
              {
                label: t('Trace ID'),
                getter: (trace: TraceSummary) => (
                  <Button sx={traceIdStyle} onClick={() => onSelectTrace(trace.id)}>
                    {trace.id}
                  </Button>
                ),
              },
              {
                label: t('Root service'),
                getter: (trace: TraceSummary) => trace.service ?? t('Not reported'),
              },
              {
                label: t('Root operation'),
                getter: (trace: TraceSummary) => trace.operation ?? t('Not reported'),
              },
              {
                label: t('Start'),
                getter: (trace: TraceSummary) => traceDate(trace.startNs).toLocaleString(),
              },
              {
                label: t('Duration (ms)'),
                getter: (trace: TraceSummary) =>
                  formatMilliseconds(traceMilliseconds(trace.durationNs)),
              },
              {
                label: t('Returned / matched spans'),
                getter: (trace: TraceSummary) =>
                  trace.spanCount ?? trace.matchedSpans ?? t('Not reported'),
              },
            ]}
          />
        </SectionBox>
      )}
    </RequestStatus>
  );
}

function TraceScope({ cluster }: { cluster: string }) {
  const { t } = useTranslation();
  const state = useKialiConfig();
  const location = useLocation();
  const history = useHistory();
  const params = new URLSearchParams(location.search);
  const linkedTrace = params.get('trace');
  const [service, setService] = useState(params.get('service') ?? '');
  const [operation, setOperation] = useState('');
  const [minutes, setMinutes] = useState(15);
  const [limit, setLimit] = useState(20);
  const [minimum, setMinimum] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [tags, setTags] = useState<(TraceTagFilter & { id: number })[]>([]);
  const nextTag = useRef(0);
  const [attributeFilters, setAttributeFilters] = useState<AttributeFilterRow[]>([]);
  const nextAttribute = useRef(0);
  const [intrinsicFilters, setIntrinsicFilters] = useState<IntrinsicFilterRow[]>([]);
  const nextIntrinsic = useRef(0);
  const [currentTime, setCurrentTime] = useState(true);
  const [endTime, setEndTime] = useState('');
  const [search, setSearch] = useState<{ query: TraceQuery; configKey: string }>();
  const [traceInput, setTraceInput] = useState(linkedTrace ?? '');
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const config = state.valid ? getClusterConfig(state.config, cluster).tracing : null;
  const configKey = JSON.stringify(config);
  useEffect(() => setSearch(undefined), [configKey]);
  function captureWindow() {
    const end = currentTime
      ? Math.floor(Date.now() / 1000)
      : Math.floor(new Date(endTime).getTime() / 1000);
    if (end > Math.floor(Date.now() / 1000))
      throw new Error(t('Choose a trace search end time that is not in the future'));
    return { start: end - minutes * 60, end };
  }
  let selected: string | undefined;
  let linkError: string | undefined;
  if (linkedTrace !== null) {
    try {
      selected = traceId(linkedTrace);
    } catch (error) {
      linkError = error instanceof Error ? error.message : t('Invalid trace ID');
    }
  }
  useEffect(() => setTraceInput(linkedTrace ?? ''), [linkedTrace]);
  function select(id: string) {
    try {
      const normalized = traceId(id);
      setAttempt(current => current + 1);
      setTraceInput(normalized);
      setError('');
      const next = new URLSearchParams(location.search);
      next.set('trace', normalized);
      history.replace({ ...location, search: next.toString() });
    } catch (error) {
      setError(error instanceof Error ? error.message : t('Invalid trace ID'));
    }
  }
  return (
    <>
      <SectionBox title={t('Traces')} headerProps={{ headerStyle: 'main' }}>
        <Stack spacing={2}>
          <Alert severity="info">
            {t(
              'Queries use the configured in-cluster HTTP tracing Service through Headlamp. The plugin does not install a tracing provider. Search results may be sampled or limited; trace attributes can contain sensitive application data and are not saved in plugin settings. Changing the tracing connection discards submitted searches; drafts require a new submission.'
            )}
          </Alert>
          {state.valid === false && <Alert severity="error">{state.message}</Alert>}
          {!config && (
            <Alert severity="info">
              {t('Configure an existing Jaeger or Tempo query Service before searching traces.')}{' '}
              <Link routeName="kiali-settings">{t('Connection settings')}</Link>
            </Alert>
          )}
          {config && (
            <Typography>
              {config.provider}: {config.endpoint.namespace}/{config.endpoint.service}:
              {config.endpoint.port}
            </Typography>
          )}
          {config && (
            <TraceNameDiscovery
              key={JSON.stringify([cluster, config])}
              cluster={cluster}
              config={config}
              service={service}
              getWindow={captureWindow}
              onService={setService}
              onOperation={setOperation}
            />
          )}
          <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap">
            <TextField
              label={t('Tracing service name')}
              value={service}
              onChange={event => setService(event.target.value)}
            />
            <TextField
              label={t('Operation filter')}
              value={operation}
              onChange={event => setOperation(event.target.value)}
            />
            <TextField
              label={t('Minimum duration (ms)')}
              type="number"
              value={minimum}
              inputProps={{ min: 0 }}
              onChange={event => setMinimum(event.target.value)}
            />
            <TextField
              select
              label={t('Trace time range')}
              value={minutes}
              onChange={event => setMinutes(Number(event.target.value))}
            >
              {[5, 15, 60, 1440].map(value => (
                <MenuItem key={value} value={value}>
                  {t('{{count}} minutes', { count: value })}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label={t('Trace limit')}
              value={limit}
              sx={{ minWidth: 140 }}
              onChange={event => setLimit(Number(event.target.value))}
            >
              {[20, 50, 100].map(value => (
                <MenuItem key={value} value={value}>
                  {value}
                </MenuItem>
              ))}
            </TextField>
            <FormControlLabel
              label={t('Reported errors only')}
              control={
                <Switch
                  checked={errorsOnly}
                  onChange={event => setErrorsOnly(event.target.checked)}
                />
              }
            />
          </Stack>
          <Stack spacing={1}>
            <Typography variant="body2">
              {t(
                'Additional tags are exact string matches combined with AND, not raw query syntax. Enter literal keys; Tempo quotes punctuation and Unicode automatically. The error tag accepts true/false and maps to reported status in Tempo; false does not imply health. Filters are not saved to settings or page navigation URLs, but are sent in provider request URLs and may appear in request logs.'
              )}
            </Typography>
            {tags.map((filter, index) => (
              <Stack key={filter.id} direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <TextField
                  label={t('Tag name {{index}}', { index: index + 1 })}
                  value={filter.key}
                  inputProps={{ maxLength: 256 }}
                  onChange={event =>
                    setTags(rows =>
                      rows.map(row =>
                        row.id === filter.id ? { ...row, key: event.target.value } : row
                      )
                    )
                  }
                />
                <TextField
                  label={t('Tag value {{index}}', { index: index + 1 })}
                  value={filter.value}
                  inputProps={{ maxLength: 1024 }}
                  onChange={event =>
                    setTags(rows =>
                      rows.map(row =>
                        row.id === filter.id ? { ...row, value: event.target.value } : row
                      )
                    )
                  }
                />
                <Button
                  aria-label={t('Remove tag filter {{index}}', { index: index + 1 })}
                  onClick={() => setTags(rows => rows.filter(row => row.id !== filter.id))}
                >
                  {t('Remove tag')}
                </Button>
              </Stack>
            ))}
            <Button
              sx={{ alignSelf: 'flex-start' }}
              disabled={tags.length >= 10}
              onClick={() => {
                const id = nextTag.current++;
                setTags(rows => [...rows, { id, key: '', value: '' }]);
              }}
            >
              {t('Add tag filter')}
            </Button>
            <FormControlLabel
              label={t('Use current trace search time')}
              control={
                <Switch
                  checked={currentTime}
                  onChange={event => setCurrentTime(event.target.checked)}
                />
              }
            />
            {(config?.provider === 'tempo' || attributeFilters.length > 0) && (
              <TraceAttributeFilters
                filters={attributeFilters}
                enabled={config?.provider === 'tempo'}
                onChange={setAttributeFilters}
                onAdd={() => {
                  const id = nextAttribute.current++;
                  setAttributeFilters(rows => [
                    ...rows,
                    {
                      id,
                      scope: 'span',
                      key: '',
                      type: 'string',
                      operator: '=',
                      value: '',
                    },
                  ]);
                }}
              />
            )}
            {(config?.provider === 'tempo' || intrinsicFilters.length > 0) && (
              <TraceIntrinsicFilters
                filters={intrinsicFilters}
                enabled={config?.provider === 'tempo'}
                onChange={setIntrinsicFilters}
                onAdd={() => {
                  const id = nextIntrinsic.current++;
                  setIntrinsicFilters(rows => [
                    ...rows,
                    { id, field: 'name', operator: '=', value: '' },
                  ]);
                }}
              />
            )}
            {!currentTime && (
              <TextField
                type="datetime-local"
                label={t('Trace search end time (local time)')}
                InputLabelProps={{ shrink: true }}
                value={endTime}
                onChange={event => setEndTime(event.target.value)}
              />
            )}
            <Typography variant="body2">
              {t(
                'Trace searches and detail reads stop after 15 seconds. Choose a narrower time range for slow searches; use Load trace to retry a failed detail read.'
              )}
            </Typography>
            <Button
              variant="contained"
              sx={{ alignSelf: 'flex-start' }}
              disabled={!config}
              onClick={() => {
                try {
                  const next = {
                    ...captureWindow(),
                    service,
                    operation: operation || undefined,
                    limit,
                    errorsOnly,
                    minDurationMs: minimum === '' ? undefined : Number(minimum),
                    tags: tags.map(({ key, value }) => ({ key, value })),
                    tempoFilters: attributeFilters.map(({ scope, key, type, operator, value }) => ({
                      scope,
                      key,
                      type,
                      operator,
                      value,
                    })),
                    tempoIntrinsics: intrinsicFilters.map(({ field, operator, value }) => ({
                      field,
                      operator,
                      value,
                    })),
                  };
                  if (!config) throw new Error(t('Tracing is not configured'));
                  traceSearchPath(config.provider, next);
                  setSearch({ query: next, configKey });
                  setError('');
                } catch (error) {
                  setError(error instanceof Error ? error.message : t('Invalid trace query'));
                }
              }}
            >
              {t('Search traces')}
            </Button>
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField
              label={t('Trace ID')}
              value={traceInput}
              onChange={event => setTraceInput(event.target.value)}
              sx={{ flex: 1 }}
            />
            <Button disabled={!config} onClick={() => select(traceInput)}>
              {t('Load trace')}
            </Button>
          </Stack>
          {(error || linkError) && <Alert severity="error">{error || linkError}</Alert>}
        </Stack>
      </SectionBox>
      {config && search && search.configKey === configKey && (
        <Search cluster={cluster} config={config} query={search.query} onSelectTrace={select} />
      )}
      {config && selected && (
        <Detail
          key={JSON.stringify([config, selected, attempt])}
          cluster={cluster}
          config={config}
          id={selected}
          onSelectTrace={select}
        />
      )}
    </>
  );
}
export default function Traces() {
  return (
    <ClusterScope>
      {scope => <TraceScope key={scope.cluster} cluster={scope.cluster} />}
    </ClusterScope>
  );
}
