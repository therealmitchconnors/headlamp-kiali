import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { CircuitBreakerDraft } from '../../core/circuitBreaker';

export default function CircuitBreakerEditor({
  draft,
  onChange,
  disabled,
  error,
  creating = false,
}: {
  draft: CircuitBreakerDraft;
  onChange: (draft: CircuitBreakerDraft) => void;
  disabled?: boolean;
  error?: string;
  creating?: boolean;
}) {
  const { t } = useTranslation();
  const mode = (field: 'connectionPoolMode' | 'outlierMode', value: string) => {
    if (value === 'keep' || value === 'set' || value === 'remove')
      onChange({ ...draft, [field]: value });
  };
  return (
    <Stack spacing={2}>
      <Typography variant="h6" component="h3">
        {t('Circuit breaking')}
      </Typography>
      <Alert severity="warning">
        {t(
          'Connection limits can reject requests and outlier detection can eject backends. Only top-level policy is edited; subset and port overrides are preserved and may take precedence.'
        )}
      </Alert>
      <TextField
        select
        label={t('Connection pool change')}
        value={draft.connectionPoolMode}
        disabled={disabled}
        onChange={event => mode('connectionPoolMode', event.target.value)}
      >
        <MenuItem value="keep">{creating ? t('Not included') : t('Keep existing')}</MenuItem>
        <MenuItem value="set">{t('Set values')}</MenuItem>
        {!creating && (
          <MenuItem value="remove">{t('Remove all connection pool settings')}</MenuItem>
        )}
      </TextField>
      {draft.connectionPoolMode === 'set' && (
        <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap">
          <TextField
            label={t('Maximum connections')}
            type="number"
            value={draft.maxConnections}
            disabled={disabled}
            inputProps={{ min: 0, max: 2147483647, step: 1 }}
            onChange={event => onChange({ ...draft, maxConnections: event.target.value })}
          />
          <TextField
            label={t('HTTP/1 pending requests')}
            type="number"
            value={draft.http1MaxPendingRequests}
            disabled={disabled}
            inputProps={{ min: 0, max: 2147483647, step: 1 }}
            onChange={event => onChange({ ...draft, http1MaxPendingRequests: event.target.value })}
          />
        </Stack>
      )}
      <TextField
        select
        label={t('Outlier detection change')}
        value={draft.outlierMode}
        disabled={disabled}
        onChange={event => mode('outlierMode', event.target.value)}
      >
        <MenuItem value="keep">{creating ? t('Not included') : t('Keep existing')}</MenuItem>
        <MenuItem value="set">{t('Set values')}</MenuItem>
        {!creating && (
          <MenuItem value="remove">{t('Remove all outlier detection settings')}</MenuItem>
        )}
      </TextField>
      {draft.outlierMode === 'set' && (
        <>
          <TextField
            label={t('Consecutive 5xx errors')}
            type="number"
            value={draft.consecutive5xxErrors}
            disabled={disabled}
            inputProps={{ min: 0, max: 4294967295, step: 1 }}
            onChange={event => onChange({ ...draft, consecutive5xxErrors: event.target.value })}
          />
          <Alert severity="info">
            {t(
              'Setting this threshold writes consecutive5xxErrors and removes the deprecated consecutiveErrors alias. Other outlier settings are preserved. Zero is explicit, not an omitted value.'
            )}
          </Alert>
        </>
      )}
      {error && <Alert severity="warning">{error}</Alert>}
    </Stack>
  );
}
