import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  EditableHttpRoute,
  HttpBehaviorDraft,
  initialHttpBehavior,
} from '../../core/httpRouteBehavior';

export function HttpBehaviorWarning({ draft }: { draft: HttpBehaviorDraft }) {
  const { t } = useTranslation();
  return (
    <>
      {(draft.delayMode === 'set' || draft.abortMode === 'set') && (
        <Alert severity="warning">
          {t(
            'Fault injection intentionally delays or rejects requests. Do not combine faults with explicit timeout/retry settings in this editor. Confirm the full proposal before applying.'
          )}
        </Alert>
      )}
      {draft.retryMode === 'set' && (
        <Alert severity="warning">
          {t(
            'Retries can repeat requests and their side effects. Check the application retry semantics before confirming.'
          )}
        </Alert>
      )}
    </>
  );
}

export default function HttpRouteBehaviorEditor({
  routes,
  draft,
  onChange,
  error,
  disabled,
  creating = false,
}: {
  routes: EditableHttpRoute[];
  draft: HttpBehaviorDraft;
  onChange: (draft: HttpBehaviorDraft) => void;
  error?: string;
  disabled: boolean;
  creating?: boolean;
}) {
  const { t } = useTranslation();
  const mode = (field: 'timeoutMode' | 'retryMode' | 'delayMode' | 'abortMode', label: string) => (
    <TextField
      select
      label={label}
      value={draft[field]}
      disabled={disabled}
      onChange={event => {
        const value = event.target.value;
        if (value === 'keep' || value === 'set' || value === 'remove')
          onChange({ ...draft, [field]: value });
      }}
    >
      <MenuItem value="keep">{creating ? t('Not included') : t('Keep existing')}</MenuItem>
      <MenuItem value="set">{t('Set value')}</MenuItem>
      {!creating && <MenuItem value="remove">{t('Remove setting')}</MenuItem>}
    </TextField>
  );
  const field = (
    key:
      | 'timeout'
      | 'attempts'
      | 'perTryTimeout'
      | 'retryOn'
      | 'delay'
      | 'delayPercent'
      | 'abortStatus'
      | 'abortPercent',
    label: string,
    numeric = false,
    helperText?: string
  ) => (
    <TextField
      label={label}
      value={draft[key]}
      disabled={disabled}
      type={numeric ? 'number' : 'text'}
      helperText={helperText}
      onChange={event => onChange({ ...draft, [key]: event.target.value })}
    />
  );
  return (
    <Stack spacing={2}>
      {creating && (
        <Typography variant="h6" component="h3">
          {t('HTTP timeout, retries and faults')}
        </Typography>
      )}
      <Alert severity="info">
        {creating
          ? t(
              'Only selected HTTP behavior is added to the new VirtualService. Not included omits the setting. Forwarding weights, mirrors and the DestinationRule are configured separately. These controls require HTTP/gRPC routing.'
            )
          : t(
              'Only explicitly selected HTTP behavior fields change. Other routes, destinations, weights, matches and unknown fields are preserved. Removing a setting restores inheritance; it does not necessarily disable that behavior.'
            )}
      </Alert>
      {!creating && !routes.length && (
        <Alert severity="info">
          {t('No editable HTTP forwarding routes exist. Use the specification editor.')}
        </Alert>
      )}
      {!creating && !!routes.length && (
        <TextField
          select
          label={t('HTTP route')}
          value={draft.routeIndex}
          disabled={disabled}
          onChange={event =>
            onChange(
              initialHttpBehavior(routes.find(route => route.index === Number(event.target.value)))
            )
          }
        >
          {routes.map(route => (
            <MenuItem key={route.index} value={route.index}>
              {t('HTTP route {{index}}', { index: route.index + 1 })}
              {route.name ? `: ${route.name}` : ''}
            </MenuItem>
          ))}
        </TextField>
      )}
      {mode('timeoutMode', t('Request timeout action'))}
      {draft.timeoutMode === 'set' &&
        field(
          'timeout',
          t('Request timeout'),
          false,
          t(
            'Use 1ms through 24h. A route timeout of 0s disables its timeout; removing it restores defaults.'
          )
        )}
      {mode('retryMode', t('Retry action'))}
      {draft.retryMode === 'set' && (
        <>
          {field('attempts', t('Retry attempts'), true, t('Whole number from 0 to 10.'))}
          {field(
            'perTryTimeout',
            t('Per-try timeout'),
            false,
            t('Optional; use 1ms through 24h. Keep it within the overall request timeout.')
          )}
          {field(
            'retryOn',
            t('Retry conditions'),
            false,
            t('Comma-separated Envoy retry conditions. Blank removes the explicit condition list.')
          )}
        </>
      )}
      {mode('delayMode', t('Delay fault action'))}
      {draft.delayMode === 'set' && (
        <>
          {field(
            'delay',
            t('Fixed delay'),
            false,
            t('Use 1ms through 24h. Setting this replaces any alternative delay type.')
          )}
          {field('delayPercent', t('Delay percentage'), true)}
        </>
      )}
      {mode('abortMode', t('HTTP abort action'))}
      {draft.abortMode === 'set' && (
        <>
          {field(
            'abortStatus',
            t('HTTP abort status'),
            true,
            t('Integer status from 100 to 599. Setting this replaces gRPC/HTTP2 abort types.')
          )}
          {field('abortPercent', t('Abort percentage'), true)}
        </>
      )}
      <HttpBehaviorWarning draft={draft} />
      {error && <Alert severity="warning">{error}</Alert>}
    </Stack>
  );
}
