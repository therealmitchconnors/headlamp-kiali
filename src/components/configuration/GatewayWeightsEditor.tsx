import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { GatewayWeightedRule, GatewayWeightsDraft } from '../../core/gatewayRouteWeights';

export function GatewayWeightsWarning() {
  const { t } = useTranslation();
  return (
    <Alert severity="warning">
      {t(
        'Gateway API weights are relative proportions, not percentages; they need not total 100. An omitted weight defaults to 1, and zero removes this backend from weighted forwarding. Only weights change: names, kinds, namespaces, ports, matches and filters are preserved. Backend readiness, ReferenceGrants, listener attachment and controller support are not verified.'
      )}
    </Alert>
  );
}
export default function GatewayWeightsEditor({
  rules,
  draft,
  onChange,
  disabled,
  error,
}: {
  rules: GatewayWeightedRule[];
  draft: GatewayWeightsDraft;
  onChange: (draft: GatewayWeightsDraft) => void;
  disabled: boolean;
  error?: string;
}) {
  const { t } = useTranslation();
  const selected = rules.find(rule => rule.index === draft.ruleIndex);
  return (
    <Stack spacing={2}>
      <GatewayWeightsWarning />
      {!rules.length && (
        <Alert severity="info">
          {t(
            'No editable Gateway backend lists are available. Use the specification editor to create or remove routing rules.'
          )}
        </Alert>
      )}
      {!!rules.length && (
        <TextField
          select
          label={t('Gateway API rule')}
          value={draft.ruleIndex}
          disabled={disabled}
          onChange={event => {
            const rule = rules.find(rule => rule.index === Number(event.target.value));
            onChange({
              ruleIndex: rule?.index ?? -1,
              weights: rule?.backends.map(backend => String(backend.weight)) ?? [],
            });
          }}
        >
          {rules.map(rule => (
            <MenuItem key={rule.index} value={rule.index}>
              {t('Rule {{index}}', { index: rule.index + 1 })}
              {rule.name ? `: ${rule.name}` : ''}
            </MenuItem>
          ))}
        </TextField>
      )}
      {selected?.backends.map((backend, index) => (
        <TextField
          key={index}
          label={t('Backend {{index}} relative weight', { index: index + 1 })}
          value={draft.weights[index] ?? ''}
          disabled={disabled}
          helperText={`${backend.group || 'core'}/${backend.kind ?? 'Service'} ${
            backend.namespace ?? t('Same namespace')
          }/${backend.name}${backend.port ? `:${backend.port}` : ''}`}
          onChange={event =>
            onChange({
              ...draft,
              weights: draft.weights.map((value, position) =>
                position === index ? event.target.value : value
              ),
            })
          }
        />
      ))}
      {error && <Alert severity="warning">{error}</Alert>}
    </Stack>
  );
}
