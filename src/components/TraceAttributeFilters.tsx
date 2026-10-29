import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  TempoAttributeFilter,
  TRACE_ATTRIBUTE_OPERATORS,
  TRACE_ATTRIBUTE_SCOPES,
  TRACE_ATTRIBUTE_TYPES,
  traceAttributeOperatorAllowed,
} from '../core/traceFilters';

export type AttributeFilterRow = TempoAttributeFilter & { id: number };
export default function TraceAttributeFilters({
  filters,
  enabled,
  onChange,
  onAdd,
}: {
  filters: AttributeFilterRow[];
  enabled: boolean;
  onChange: (filters: AttributeFilterRow[]) => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  const update = (id: number, patch: Partial<TempoAttributeFilter>) =>
    onChange(filters.map(filter => (filter.id === id ? { ...filter, ...patch } : filter)));
  const scopes = {
    span: t('Span'),
    resource: t('Resource'),
    unscoped: t('Span or resource'),
    event: t('Event'),
    link: t('Span link'),
    instrumentation: t('Instrumentation scope'),
  };
  const types = {
    string: t('String'),
    integer: t('Integer'),
    float: t('Float'),
    boolean: t('Boolean'),
    nil: t('Missing/null'),
  };
  return (
    <Stack spacing={2}>
      <Typography variant="h6" component="h3">
        {t('Tempo attribute filters')}
      </Typography>
      <Alert severity="info">
        {t(
          'These typed comparisons are ANDed with other filters on the matched span, not across different spans. Event, span-link and instrumentation attributes retain their reported scopes; these controls do not express a same-event/link join or follow linked traces. Attribute scopes are explicit, not inferred from names, and are not intrinsic fields. Regexes follow Tempo whole-string matching; use .* for substrings. String ranges are lexicographic. Backend version, storage support and array semantics can affect results.'
        )}
      </Alert>
      {!enabled && (
        <Alert severity="warning">
          {t('Typed attribute filters require Tempo; remove them before searching Jaeger.')}
        </Alert>
      )}
      {filters.map((filter, index) => (
        <Stack key={filter.id} spacing={1}>
          <TextField
            select
            label={t('Attribute scope {{index}}', { index: index + 1 })}
            value={filter.scope}
            onChange={event => {
              const scope = TRACE_ATTRIBUTE_SCOPES.find(value => value === event.target.value);
              if (scope) update(filter.id, { scope });
            }}
          >
            {TRACE_ATTRIBUTE_SCOPES.map(scope => (
              <MenuItem key={scope} value={scope}>
                {scopes[scope]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('Attribute name {{index}}', { index: index + 1 })}
            value={filter.key}
            inputProps={{ maxLength: 256 }}
            helperText={t(
              'Enter the literal name without a scope prefix or added quotes, for example http.status_code. Punctuation and Unicode are quoted automatically; controls and surrounding whitespace are rejected.'
            )}
            onChange={event => update(filter.id, { key: event.target.value })}
          />
          <TextField
            select
            label={t('Attribute type {{index}}', { index: index + 1 })}
            value={filter.type}
            onChange={event => {
              const type = TRACE_ATTRIBUTE_TYPES.find(value => value === event.target.value);
              if (type) update(filter.id, { type, ...(type === 'nil' ? { value: '' } : {}) });
            }}
          >
            {TRACE_ATTRIBUTE_TYPES.map(type => (
              <MenuItem key={type} value={type}>
                {types[type]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label={t('Attribute comparison {{index}}', { index: index + 1 })}
            value={filter.operator}
            onChange={event => {
              const operator = TRACE_ATTRIBUTE_OPERATORS.find(
                value => value === event.target.value
              );
              if (operator) update(filter.id, { operator });
            }}
          >
            {TRACE_ATTRIBUTE_OPERATORS.map(operator => (
              <MenuItem
                key={operator}
                value={operator}
                disabled={!traceAttributeOperatorAllowed(filter.type, operator)}
              >
                {operator}
              </MenuItem>
            ))}
          </TextField>
          {filter.type === 'nil' ? (
            <Typography variant="body2">
              {t(
                'Use = to find a missing/null attribute, or != to require a present, non-null attribute. This is not a health verdict.'
              )}
            </Typography>
          ) : (
            <TextField
              label={t('Attribute value {{index}}', { index: index + 1 })}
              value={filter.value}
              inputProps={{ maxLength: 1024 }}
              helperText={
                filter.type === 'integer'
                  ? t(
                      'Signed 64-bit decimal. Integer text is not rounded through JavaScript numbers.'
                    )
                  : filter.type === 'float'
                  ? t('Finite 64-bit decimal or exponent; overflow and underflow are rejected.')
                  : filter.type === 'boolean'
                  ? t(
                      'Enter true or false. This is an attribute value, not the reported span status.'
                    )
                  : t('Literal string, or RE2 expression for =~ / !~. Empty strings are allowed.')
              }
              onChange={event => update(filter.id, { value: event.target.value })}
            />
          )}
          <Button onClick={() => onChange(filters.filter(row => row.id !== filter.id))}>
            {t('Remove attribute filter {{index}}', { index: index + 1 })}
          </Button>
        </Stack>
      ))}
      <Button disabled={!enabled || filters.length >= 10} onClick={onAdd}>
        {t('Add attribute filter')}
      </Button>
    </Stack>
  );
}
