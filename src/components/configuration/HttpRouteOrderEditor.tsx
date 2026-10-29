import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { EditableHttpRoute } from '../../core/httpRouteBehavior';
import { HttpRouteOrderDraft } from '../../core/httpRouteOrder';

export function RouteOrderWarning() {
  const { t } = useTranslation();
  return (
    <Alert severity="warning">
      {t(
        'HTTP routes use first-match ordering. Moving a route can change which destinations, redirects or faults handle requests. Whole routes and all their fields are preserved. Clearly unconditional routes must be last; delegated rules and more complex overlaps or reachability are not analyzed.'
      )}
    </Alert>
  );
}

export default function HttpRouteOrderEditor({
  routes,
  draft,
  onChange,
  order,
  disabled,
  error,
}: {
  routes: EditableHttpRoute[];
  draft: HttpRouteOrderDraft;
  onChange: (draft: HttpRouteOrderDraft) => void;
  order?: EditableHttpRoute[];
  disabled: boolean;
  error?: string;
}) {
  const { t } = useTranslation();
  return (
    <Stack spacing={2}>
      <RouteOrderWarning />
      {routes.length >= 2 && (
        <>
          <TextField
            select
            label={t('HTTP route to move')}
            value={draft.from}
            disabled={disabled}
            onChange={event => {
              const from = Number(event.target.value);
              onChange({ from, to: from });
            }}
          >
            {routes.map(route => (
              <MenuItem key={route.index} value={route.index}>
                {t('HTTP route {{index}}', { index: route.index + 1 })}
                {route.name ? `: ${route.name}` : ''}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label={t('New route position')}
            value={draft.to}
            disabled={disabled}
            onChange={event => onChange({ ...draft, to: Number(event.target.value) })}
          >
            {routes.map(route => (
              <MenuItem key={route.index} value={route.index}>
                {t('Position {{index}}', { index: route.index + 1 })}
              </MenuItem>
            ))}
          </TextField>
        </>
      )}
      <SimpleTable
        data={(order ?? routes).map((route, index) => ({
          original: route.index + 1,
          proposed: index + 1,
          name: route.name,
        }))}
        columns={[
          { label: t('Route name'), getter: item => item.name ?? t('Unnamed') },
          { label: t('Current position'), getter: item => item.original },
          { label: t('Proposed position'), getter: item => item.proposed },
        ]}
      />
      {error && <Alert severity="warning">{error}</Alert>}
    </Stack>
  );
}
