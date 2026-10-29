import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { PEER_MTLS_MODES, PeerMtlsDraft } from '../../core/peerMtlsEditing';

export function PeerMtlsWarning({ draft }: { draft: PeerMtlsDraft }) {
  const { t } = useTranslation();
  return (
    <Stack spacing={1}>
      <Alert severity="warning">
        {t(
          'Inbound mTLS changes can break connections or allow plaintext traffic. The existing selector and workload-port overrides are preserved. A policy without a restrictive selector may affect an entire namespace or mesh, depending on its root-namespace location. This editor does not resolve effective policy, update DestinationRules or prove encryption.'
        )}
      </Alert>
      {draft.action === 'remove' || draft.mode === 'UNSET' ? (
        <Alert severity="info">
          {t(
            'Removing the top-level mTLS block or setting UNSET restores parent inheritance; without a parent the API treats UNSET as PERMISSIVE. Port-level overrides remain unchanged. This does not explicitly disable mTLS.'
          )}
        </Alert>
      ) : draft.mode === 'DISABLE' ? (
        <Alert severity="warning">
          {t(
            'DISABLE disables inbound mTLS under this policy. It is not supported in ambient mode; ambient encryption and other policy layers must be assessed separately.'
          )}
        </Alert>
      ) : draft.mode === 'PERMISSIVE' ? (
        <Alert severity="warning">
          {t(
            'PERMISSIVE allows both plaintext and mTLS under this policy. This is not a requirement that every connection be encrypted.'
          )}
        </Alert>
      ) : draft.mode === 'STRICT' ? (
        <Alert severity="warning">
          {t(
            'STRICT requires mTLS under this policy and can reject clients that do not present compatible identities. Confirm client and server compatibility before applying.'
          )}
        </Alert>
      ) : null}
    </Stack>
  );
}
export default function PeerMtlsEditor({
  draft,
  onChange,
  disabled,
  error,
}: {
  draft: PeerMtlsDraft;
  onChange: (draft: PeerMtlsDraft) => void;
  disabled: boolean;
  error?: string;
}) {
  const { t } = useTranslation();
  return (
    <Stack spacing={2}>
      <TextField
        select
        label={t('Inbound mTLS change')}
        value={draft.action}
        disabled={disabled}
        onChange={event => {
          const action = event.target.value;
          if (action === 'keep' || action === 'set' || action === 'remove')
            onChange({ ...draft, action });
        }}
      >
        <MenuItem value="keep">{t('Keep existing')}</MenuItem>
        <MenuItem value="set">{t('Set explicit mTLS mode')}</MenuItem>
        <MenuItem value="remove">{t('Remove top-level mTLS policy')}</MenuItem>
      </TextField>
      {draft.action === 'set' && (
        <TextField
          select
          label={t('Inbound mTLS mode')}
          value={draft.mode}
          disabled={disabled}
          onChange={event => {
            const mode = PEER_MTLS_MODES.find(mode => mode === event.target.value);
            if (mode) onChange({ ...draft, mode });
          }}
        >
          <MenuItem value="" disabled>
            {t('Select an mTLS mode')}
          </MenuItem>
          {PEER_MTLS_MODES.map(mode => (
            <MenuItem key={mode} value={mode}>
              {mode}
            </MenuItem>
          ))}
        </TextField>
      )}
      <PeerMtlsWarning draft={draft} />
      {error && <Alert severity="warning">{error}</Alert>}
    </Stack>
  );
}
