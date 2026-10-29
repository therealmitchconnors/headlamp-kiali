import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { HttpMirroringDraft, initialHttpMirroring } from '../../core/httpMirroring';
import { EditableHttpRoute } from '../../core/httpRouteBehavior';

export function MirroringWarning() {
  const { t } = useTranslation();
  return (
    <Alert severity="warning">
      {t(
        'Mirroring duplicates requests and can repeat writes or other side effects at the shadow destination. Shadow responses are not returned to the caller. The mirror percentage is independent of forwarding weights; this does not prove target readiness or safe processing. The shadow destination may also receive ordinary traffic through other or default routes.'
      )}
    </Alert>
  );
}

export default function HttpMirroringEditor({
  routes,
  draft,
  onChange,
  disabled,
  error,
}: {
  routes: EditableHttpRoute[];
  draft: HttpMirroringDraft;
  onChange: (draft: HttpMirroringDraft) => void;
  disabled: boolean;
  error?: string;
}) {
  const { t } = useTranslation();
  return (
    <Stack spacing={2}>
      <Alert severity="info">
        {t(
          'Setting one mirror replaces all mirror targets on this route, including the mirrors list and deprecated percentage fields. Removing clears all mirror forms. Other routes, matches, destinations, weights and policies are preserved. Use the specification editor to manage multiple mirrors.'
        )}
      </Alert>
      {routes.length ? (
        <TextField
          select
          label={t('HTTP route')}
          value={draft.routeIndex}
          disabled={disabled}
          onChange={event =>
            onChange(
              initialHttpMirroring(routes.find(route => route.index === Number(event.target.value)))
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
      ) : (
        <Alert severity="info">
          {t('No editable HTTP forwarding routes exist. Use the specification editor.')}
        </Alert>
      )}
      <TextField
        select
        label={t('Mirroring change')}
        value={draft.mode}
        disabled={disabled}
        onChange={event => {
          const mode = event.target.value;
          if (mode === 'keep' || mode === 'set' || mode === 'remove') onChange({ ...draft, mode });
        }}
      >
        <MenuItem value="keep">{t('Keep existing')}</MenuItem>
        <MenuItem value="set">{t('Replace with one mirror')}</MenuItem>
        <MenuItem value="remove">{t('Remove all mirrors')}</MenuItem>
      </TextField>
      {draft.mode === 'set' && (
        <>
          <TextField
            label={t('Mirror host')}
            value={draft.host}
            disabled={disabled}
            helperText={t(
              'Use a Service or registered host name. Cross-namespace Services need a qualified name; target existence is not checked by this editor.'
            )}
            onChange={event => onChange({ ...draft, host: event.target.value })}
          />
          <TextField
            label={t('Mirror subset')}
            value={draft.subset}
            disabled={disabled}
            helperText={t('Optional DNS-label subset name from a DestinationRule.')}
            onChange={event => onChange({ ...draft, subset: event.target.value })}
          />
          <TextField
            label={t('Mirror port')}
            value={draft.port}
            disabled={disabled}
            helperText={t(
              'Optional Service port, 1 to 65535; needed when the target is ambiguous.'
            )}
            onChange={event => onChange({ ...draft, port: event.target.value })}
          />
          <TextField
            label={t('Mirror percentage')}
            value={draft.percentage}
            disabled={disabled}
            helperText={t('Decimal percentage from 0 to 100. Zero explicitly mirrors no requests.')}
            onChange={event => onChange({ ...draft, percentage: event.target.value })}
          />
          <MirroringWarning />
        </>
      )}
      {error && <Alert severity="warning">{error}</Alert>}
    </Stack>
  );
}
