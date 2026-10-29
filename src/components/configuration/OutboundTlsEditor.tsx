import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { OUTBOUND_TLS_MODES, OutboundTlsDraft } from '../../core/outboundTls';

export function OutboundTlsWarning({ draft }: { draft: OutboundTlsDraft }) {
  const { t } = useTranslation();
  if (draft.action === 'keep') return null;
  return (
    <Stack spacing={1}>
      <Alert severity="warning">
        {t(
          'Outbound TLS changes can break connections or reduce transport security. This changes only the top-level DestinationRule policy, not PeerAuthentication or subset/port overrides. Configuration is not proof of encryption or compatible peer policy.'
        )}
      </Alert>
      <Alert severity="warning">
        {draft.action === 'remove'
          ? t(
              'Removing the entire TLS block restores inheritance and auto-mTLS behavior; it does not explicitly disable TLS.'
            )
          : draft.mode === 'DISABLE'
          ? t(
              'DISABLE stops originating TLS under this policy and removes every other field in its TLS block. Application-provided encryption is separate.'
            )
          : draft.mode === 'ISTIO_MUTUAL'
          ? t(
              'ISTIO_MUTUAL uses Istio-managed certificates and removes every other field in this TLS block, including credentials, SNI and verification overrides.'
            )
          : t(
              'SIMPLE/MUTUAL use file references in this editor and remove any credentialName secret reference. Existing SNI, subjectAltNames, caCrl and verification flags are preserved. Review them carefully; use the specification editor to manage secret-backed or advanced TLS settings.'
            )}
      </Alert>
    </Stack>
  );
}

export default function OutboundTlsEditor({
  draft,
  onChange,
  disabled,
  error,
  creating = false,
}: {
  draft: OutboundTlsDraft;
  onChange: (draft: OutboundTlsDraft) => void;
  disabled?: boolean;
  error?: string;
  creating?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Stack spacing={2}>
      <Typography variant="h6" component="h3">
        {t('Outbound TLS')}
      </Typography>
      <TextField
        select
        label={t('Outbound TLS change')}
        value={draft.action}
        disabled={disabled}
        onChange={event => {
          const action = event.target.value;
          if (action === 'keep' || action === 'set' || action === 'remove')
            onChange({ ...draft, action });
        }}
      >
        <MenuItem value="keep">{creating ? t('Not included') : t('Keep existing')}</MenuItem>
        <MenuItem value="set">{t('Set explicit TLS policy')}</MenuItem>
        {!creating && <MenuItem value="remove">{t('Remove explicit TLS policy')}</MenuItem>}
      </TextField>
      {draft.action === 'set' && (
        <>
          <TextField
            select
            label={t('Outbound TLS mode')}
            value={draft.mode}
            disabled={disabled}
            onChange={event => {
              const mode = OUTBOUND_TLS_MODES.find(value => value === event.target.value);
              if (mode) onChange({ ...draft, mode });
            }}
          >
            <MenuItem value="" disabled>
              {t('Select a TLS mode')}
            </MenuItem>
            {OUTBOUND_TLS_MODES.map(mode => (
              <MenuItem key={mode} value={mode}>
                {mode}
              </MenuItem>
            ))}
          </TextField>
          {draft.mode === 'MUTUAL' && (
            <>
              <TextField
                label={t('Client certificate file path')}
                value={draft.clientCertificate}
                disabled={disabled}
                helperText={t(
                  'Required absolute path inside the proxy container, not the Headlamp host. Do not paste certificate contents.'
                )}
                onChange={event => onChange({ ...draft, clientCertificate: event.target.value })}
              />
              <TextField
                label={t('Private key file path')}
                value={draft.privateKey}
                disabled={disabled}
                helperText={t(
                  'Required absolute path inside the proxy container. Do not paste private key contents.'
                )}
                onChange={event => onChange({ ...draft, privateKey: event.target.value })}
              />
            </>
          )}
          {(draft.mode === 'SIMPLE' || draft.mode === 'MUTUAL') && (
            <TextField
              label={t('CA certificates file path')}
              value={draft.caCertificates}
              disabled={disabled}
              helperText={t(
                'Optional absolute path inside the proxy container. Blank removes the explicit CA path; the proxy normally uses OS CAs unless preserved verification settings change that behavior. No files or secrets are read or installed.'
              )}
              onChange={event => onChange({ ...draft, caCertificates: event.target.value })}
            />
          )}
        </>
      )}
      <OutboundTlsWarning draft={draft} />
      {error && <Alert severity="warning">{error}</Alert>}
    </Stack>
  );
}
