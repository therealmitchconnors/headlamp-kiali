import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { LoadBalancerDraft, SIMPLE_LOAD_BALANCERS } from '../../core/loadBalancer';

export default function LoadBalancerEditor({
  draft,
  onChange,
  disabled,
  error,
  creating = false,
}: {
  draft: LoadBalancerDraft;
  onChange: (draft: LoadBalancerDraft) => void;
  disabled?: boolean;
  error?: string;
  creating?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Stack spacing={2}>
      <Typography variant="h6" component="h3">
        {t('Load balancing')}
      </Typography>
      <TextField
        select
        label={t('Load-balancer change')}
        value={draft.mode}
        disabled={disabled}
        onChange={event => {
          const mode = event.target.value;
          if (mode === 'keep' || mode === 'set' || mode === 'remove') onChange({ ...draft, mode });
        }}
      >
        <MenuItem value="keep">{creating ? t('Not included') : t('Keep existing')}</MenuItem>
        <MenuItem value="set">{t('Set strategy')}</MenuItem>
        {!creating && <MenuItem value="remove">{t('Remove all load-balancer settings')}</MenuItem>}
      </TextField>
      {draft.mode !== 'keep' && (
        <Alert severity="warning">
          {draft.mode === 'remove'
            ? t(
                'Removing load-balancer configuration removes all its top-level settings, including locality and warmup. TLS, connection pools, subsets and port overrides are preserved.'
              )
            : t(
                'Changing load balancing can redistribute requests. Only top-level policy is edited; subset and port overrides are preserved. Choosing a strategy replaces incompatible affinity keys, not unrelated locality or warmup settings.'
              )}
        </Alert>
      )}
      {draft.mode === 'set' && (
        <>
          <TextField
            select
            label={t('Load-balancing strategy')}
            value={draft.strategy}
            disabled={disabled}
            onChange={event => {
              const strategy = event.target.value;
              if (
                strategy === 'simple' ||
                strategy === 'header' ||
                strategy === 'cookie' ||
                strategy === 'source-ip'
              )
                onChange({ ...draft, strategy });
            }}
          >
            <MenuItem value="simple">{t('Simple algorithm')}</MenuItem>
            <MenuItem value="header">{t('HTTP header affinity')}</MenuItem>
            <MenuItem value="cookie">{t('HTTP cookie affinity')}</MenuItem>
            <MenuItem value="source-ip">{t('Source IP affinity')}</MenuItem>
          </TextField>
          {draft.strategy === 'simple' && (
            <TextField
              select
              label={t('Simple load-balancing algorithm')}
              value={draft.simple}
              disabled={disabled}
              onChange={event => {
                const simple = SIMPLE_LOAD_BALANCERS.find(value => value === event.target.value);
                if (simple) onChange({ ...draft, simple });
              }}
            >
              {SIMPLE_LOAD_BALANCERS.map(value => (
                <MenuItem value={value} key={value}>
                  {value}
                </MenuItem>
              ))}
            </TextField>
          )}
          {draft.strategy === 'header' && (
            <TextField
              label={t('Affinity HTTP header name')}
              value={draft.header}
              disabled={disabled}
              onChange={event => onChange({ ...draft, header: event.target.value })}
            />
          )}
          {draft.strategy === 'cookie' && (
            <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap">
              <TextField
                label={t('Affinity cookie name')}
                value={draft.cookieName}
                disabled={disabled}
                onChange={event => onChange({ ...draft, cookieName: event.target.value })}
              />
              <TextField
                label={t('Affinity cookie TTL')}
                value={draft.cookieTtl}
                disabled={disabled}
                helperText={t(
                  'Use protobuf seconds, such as 0s or 30s. Existing cookie path and attributes are preserved.'
                )}
                onChange={event => onChange({ ...draft, cookieTtl: event.target.value })}
              />
            </Stack>
          )}
          {draft.strategy === 'source-ip' && (
            <Typography>
              {t(
                'Affinity uses the source IP seen by the proxy; this is not necessarily the original client address.'
              )}
            </Typography>
          )}
        </>
      )}
      {error && <Alert severity="warning">{error}</Alert>}
    </Stack>
  );
}
