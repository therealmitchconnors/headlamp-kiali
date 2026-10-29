import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  HTTP_MATCH_FIELDS,
  HTTP_MATCH_OPERATORS,
  HttpMatchCondition,
} from '../../core/httpMatches';

export function HttpMatchingWarning() {
  const { t } = useTranslation();
  return (
    <Alert severity="warning">
      {t(
        'All header conditions form one AND alternative. Each URI, scheme, method or authority condition is a separate OR alternative, following the Kiali wizard. Every alternative retains the selected Service port. These select a routing rule, not access control; unmatched requests may use other or default routing.'
      )}
    </Alert>
  );
}

export function HttpMatchConditionEditor({
  condition,
  index,
  onChange,
  disabled,
  showValue = true,
}: {
  condition: HttpMatchCondition;
  index: number;
  onChange: (condition: HttpMatchCondition) => void;
  disabled: boolean;
  showValue?: boolean;
}) {
  const { t } = useTranslation();
  const fields = {
    headers: t('Headers'),
    uri: t('URI'),
    scheme: t('Scheme'),
    method: t('Method'),
    authority: t('Authority'),
  };
  const operators = {
    exact: t('Exact'),
    prefix: t('Prefix'),
    regex: t('Regular expression'),
    presence: t('Header present'),
  };
  const update = (patch: Partial<HttpMatchCondition>) => onChange({ ...condition, ...patch });
  return (
    <Stack spacing={1}>
      <TextField
        select
        label={t('Condition {{index}} field', { index: index + 1 })}
        value={condition.field}
        disabled={disabled}
        onChange={event => {
          const field = HTTP_MATCH_FIELDS.find(value => value === event.target.value);
          if (field)
            update({
              field,
              operator:
                field !== 'headers' && condition.operator === 'presence'
                  ? 'exact'
                  : condition.operator,
            });
        }}
      >
        {HTTP_MATCH_FIELDS.map(field => (
          <MenuItem key={field} value={field}>
            {fields[field]}
          </MenuItem>
        ))}
      </TextField>
      {condition.field === 'headers' && (
        <TextField
          label={t('Condition {{index}} header name', { index: index + 1 })}
          value={condition.header}
          disabled={disabled}
          onChange={event => update({ header: event.target.value })}
          helperText={t(
            'Lowercase hyphen-separated name. Use the dedicated field for URI, scheme, method or authority.'
          )}
        />
      )}
      {showValue && (
        <TextField
          select
          label={t('Condition {{index}} operator', { index: index + 1 })}
          value={condition.operator}
          disabled={disabled}
          onChange={event => {
            const operator = HTTP_MATCH_OPERATORS.find(value => value === event.target.value);
            if (operator) update({ operator });
          }}
        >
          {HTTP_MATCH_OPERATORS.filter(
            operator => condition.field === 'headers' || operator !== 'presence'
          ).map(operator => (
            <MenuItem key={operator} value={operator}>
              {operators[operator]}
            </MenuItem>
          ))}
        </TextField>
      )}
      {showValue && condition.operator !== 'presence' && (
        <TextField
          label={t('Condition {{index}} value', { index: index + 1 })}
          value={condition.value}
          disabled={disabled}
          onChange={event => update({ value: event.target.value })}
          helperText={
            condition.operator === 'regex'
              ? t(
                  'RE2 syntax, at most 512 characters. Regex validation does not prove routing behavior.'
                )
              : t(
                  'Case-sensitive value, at most 1024 characters. Surrounding whitespace is rejected, not trimmed.'
                )
          }
        />
      )}
    </Stack>
  );
}

export default function HttpMatchBuilder({
  conditions,
  onChange,
  disabled,
}: {
  conditions: HttpMatchCondition[];
  onChange: (conditions: HttpMatchCondition[]) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Stack spacing={2}>
      <Typography variant="h6" component="h3">
        {t('HTTP request conditions')}
      </Typography>
      {!!conditions.length && <HttpMatchingWarning />}
      {conditions.map((condition, index) => (
        <Stack spacing={1} key={index}>
          <HttpMatchConditionEditor
            condition={condition}
            index={index}
            onChange={next =>
              onChange(conditions.map((value, position) => (position === index ? next : value)))
            }
            disabled={disabled}
          />
          <Button
            disabled={disabled}
            onClick={() => onChange(conditions.filter((_, position) => position !== index))}
          >
            {t('Remove condition {{index}}', { index: index + 1 })}
          </Button>
        </Stack>
      ))}
      <Button
        disabled={disabled || conditions.length >= 20}
        onClick={() =>
          onChange([...conditions, { field: 'headers', header: '', operator: 'exact', value: '' }])
        }
      >
        {t('Add HTTP condition')}
      </Button>
      <Typography variant="body2">
        {t(
          'At most 20 conditions. No conditions means only the selected Service-port constraint. TCP routing cannot use these conditions.'
        )}
      </Typography>
    </Stack>
  );
}
