import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { initialRouteWeights, WeightedRoute } from '../../core/trafficWeights';

export interface TrafficWeightsDraft {
  routeKey: string;
  weights: string[];
}

export default function TrafficWeightsEditor({
  routes,
  draft,
  onChange,
  error,
  disabled,
}: {
  routes: WeightedRoute[];
  draft: TrafficWeightsDraft;
  onChange: (draft: TrafficWeightsDraft) => void;
  error?: string;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const selected = routes.find(route => route.key === draft.routeKey);
  const total = draft.weights.reduce((sum, value) => (value.trim() ? sum + Number(value) : NaN), 0);
  return (
    <Stack spacing={2}>
      <Alert severity="info">
        {t(
          'Only the selected route weights change. Hosts, subsets, matches, mirrors and other settings are preserved. Target existence and traffic health are not verified by this editor.'
        )}
      </Alert>
      {!routes.length && (
        <Alert severity="info">
          {t(
            'No editable weighted routes are available. Use the specification editor for new routing rules.'
          )}
        </Alert>
      )}
      {routes.length > 0 && (
        <TextField
          select
          label={t('Weighted route')}
          value={draft.routeKey}
          disabled={disabled}
          onChange={event => {
            const route = routes.find(route => route.key === event.target.value);
            onChange({
              routeKey: event.target.value,
              weights: route ? initialRouteWeights(route).map(String) : [],
            });
          }}
        >
          {routes.map(route => (
            <MenuItem key={route.key} value={route.key}>
              {t('{{protocol}} route {{index}}', {
                protocol: route.protocol.toUpperCase(),
                index: route.index + 1,
              })}
              {route.name ? `: ${route.name}` : ''}
            </MenuItem>
          ))}
        </TextField>
      )}
      {selected?.destinations.map((destination, index) => (
        <TextField
          key={index}
          label={t('Destination {{index}} weight (%)', { index: index + 1 })}
          type="number"
          value={draft.weights[index] ?? ''}
          disabled={disabled}
          inputProps={{ min: 0, max: 100, step: 1 }}
          helperText={`${destination.host}${destination.subset ? ` / ${destination.subset}` : ''}`}
          onChange={event =>
            onChange({
              ...draft,
              weights: draft.weights.map((weight, i) =>
                i === index ? event.target.value : weight
              ),
            })
          }
        />
      ))}
      {selected && (
        <Typography>
          {t('Total weight')}: {Number.isFinite(total) ? `${total}%` : t('Invalid')}
        </Typography>
      )}
      {error && <Alert severity="warning">{error}</Alert>}
    </Stack>
  );
}
