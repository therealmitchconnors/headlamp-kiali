import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { TRACE_ATTRIBUTE_OPERATORS } from '../core/traceFilters';
import {
  TEMPO_INTRINSICS,
  TempoIntrinsicFilter,
  traceIntrinsicIdWidth,
  traceIntrinsicIsDuration,
  traceIntrinsicOperatorAllowed,
} from '../core/traceIntrinsics';

export type IntrinsicFilterRow = TempoIntrinsicFilter & { id: number };
export default function TraceIntrinsicFilters({
  filters,
  enabled,
  onChange,
  onAdd,
}: {
  filters: IntrinsicFilterRow[];
  enabled: boolean;
  onChange: (filters: IntrinsicFilterRow[]) => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  const update = (id: number, patch: Partial<TempoIntrinsicFilter>) =>
    onChange(filters.map(filter => (filter.id === id ? { ...filter, ...patch } : filter)));
  const names = {
    name: t('Span name'),
    statusMessage: t('Span status message'),
    duration: t('Span duration'),
    status: t('Reported span status'),
    kind: t('Span kind'),
    traceDuration: t('Whole trace duration'),
    rootName: t('Trace root span name'),
    rootServiceName: t('Trace root service name'),
    eventName: t('Event name'),
    eventTimeSinceStart: t('Event time since span start'),
    instrumentationName: t('Instrumentation scope name'),
    instrumentationVersion: t('Instrumentation scope version'),
    traceId: t('Trace ID'),
    spanId: t('Span ID'),
    parentId: t('Parent span ID'),
    linkTraceId: t('Linked trace ID'),
    linkSpanId: t('Linked span ID'),
  };
  return (
    <Stack spacing={2}>
      <Typography variant="h6" component="h3">
        {t('Tempo intrinsic filters')}
      </Typography>
      <Typography variant="body2">
        {t(
          'ID predicates compare reported hexadecimal values using = or != only; they do not follow a link or prove identity existence. Empty and zero IDs are literal provider values, not an automatic missing-parent test. Event offsets may be negative and are measured from span start, not trace start or wall-clock time.'
        )}
      </Typography>
      <Alert severity="info">
        {t(
          'Intrinsics are reported fields, not similarly named attributes. All predicates are ANDed with existing filters. Span fields apply to the same matched span; trace fields describe its whole trace and reported root. A root service may differ from the matched span service. Span duration and whole trace duration are distinct. Conflicting filters can return no traces. Status is not a health verdict. Regexes match the whole string; string ranges are lexicographic.'
        )}
      </Alert>
      <Typography variant="body2">
        {t(
          'Event and instrumentation fields describe records attached to the matched span. Multiple event conditions do not prove a match on the same event. Instrumentation identifies the reporting library, not a workload or Kubernetes Service. Version comparisons are literal or lexicographic, not semantic-version ordering.'
        )}
      </Typography>
      {!enabled && (
        <Alert severity="warning">
          {t('Intrinsic filters require Tempo; remove them before searching Jaeger.')}
        </Alert>
      )}
      {filters.map((filter, index) => (
        <Stack key={filter.id} spacing={1}>
          <TextField
            select
            label={t('Intrinsic field {{index}}', { index: index + 1 })}
            value={filter.field}
            onChange={event => {
              const field = TEMPO_INTRINSICS.find(field => field === event.target.value);
              if (field) update(filter.id, { field });
            }}
          >
            {TEMPO_INTRINSICS.map(field => (
              <MenuItem key={field} value={field}>
                {names[field]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label={t('Intrinsic comparison {{index}}', { index: index + 1 })}
            value={filter.operator}
            error={!traceIntrinsicOperatorAllowed(filter.field, filter.operator)}
            helperText={
              !traceIntrinsicOperatorAllowed(filter.field, filter.operator)
                ? t('Choose a comparison supported by this field.')
                : undefined
            }
            onChange={event => {
              const operator = TRACE_ATTRIBUTE_OPERATORS.find(
                operator => operator === event.target.value
              );
              if (operator) update(filter.id, { operator });
            }}
          >
            {TRACE_ATTRIBUTE_OPERATORS.map(operator => (
              <MenuItem
                key={operator}
                value={operator}
                disabled={!traceIntrinsicOperatorAllowed(filter.field, operator)}
              >
                {operator}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('Intrinsic value {{index}}', { index: index + 1 })}
            value={filter.value}
            inputProps={{
              maxLength:
                traceIntrinsicIdWidth(filter.field) ??
                (traceIntrinsicIsDuration(filter.field) ? 64 : 1024),
            }}
            helperText={
              traceIntrinsicIdWidth(filter.field) !== undefined
                ? t(
                    'At most {{width}} hex characters, without 0x, whitespace or base64. Case and leading zeros are preserved; an empty literal is allowed. Only = and != are supported.',
                    { width: traceIntrinsicIdWidth(filter.field) }
                  )
                : filter.field === 'eventTimeSinceStart'
                ? t(
                    'One signed quantity with ns, us, ms, s, m or h, for example -1.5ms. Whole-nanosecond precision and magnitude at most 9223372036854775807ns; never rounded.'
                  )
                : traceIntrinsicIsDuration(filter.field)
                ? t(
                    'One nonnegative quantity with ns, us, ms, s, m or h; for example 1.5ms. Whole-nanosecond precision, up to 9223372036854775807ns; never rounded.'
                  )
                : filter.field === 'status'
                ? t('Enter ok, error or unset without quotes. Only = and != are supported.')
                : filter.field === 'kind'
                ? t(
                    'Enter unspecified, internal, server, client, producer or consumer without quotes. Only = and != are supported.'
                  )
                : t('Literal string, or RE2 expression for =~ / !~. Empty strings are allowed.')
            }
            onChange={event => update(filter.id, { value: event.target.value })}
          />
          <Button onClick={() => onChange(filters.filter(row => row.id !== filter.id))}>
            {t('Remove intrinsic filter {{index}}', { index: index + 1 })}
          </Button>
        </Stack>
      ))}
      <Button disabled={!enabled || filters.length >= 10} onClick={onAdd}>
        {t('Add intrinsic filter')}
      </Button>
    </Stack>
  );
}
