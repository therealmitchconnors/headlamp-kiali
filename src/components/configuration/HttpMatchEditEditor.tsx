import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useMemo } from 'react';
import {
  existingHttpCondition,
  HttpMatchEditDraft,
  initialHttpMatchEdit,
} from '../../core/httpMatchEditing';
import { HTTP_MATCH_FIELDS } from '../../core/httpMatches';
import { EditableHttpRoute, httpMatchAlternatives } from '../../core/httpRouteBehavior';
import CodeBlock from './CodeBlock';
import { HttpMatchConditionEditor } from './HttpMatchBuilder';

export function HttpMatchEditWarning() {
  const { t } = useTranslation();
  return (
    <Alert severity="warning">
      {t(
        'Conditions inside one alternative are ANDed; alternatives are ORed. Setting or removing a condition can restrict or broaden routing. Only the chosen field or header changes; source, gateway, port, query and other restrictions remain intact. Setting a header adds or updates that name, not a rename. The preserved ignoreUriCase flag applies only to exact/prefix URI matching, not regex. These are not access controls, and complex overlap is not analyzed.'
      )}
    </Alert>
  );
}

export default function HttpMatchEditEditor({
  routes,
  draft,
  onChange,
  disabled,
  error,
}: {
  routes: EditableHttpRoute[];
  draft: HttpMatchEditDraft;
  onChange: (draft: HttpMatchEditDraft) => void;
  disabled: boolean;
  error?: string;
}) {
  const { t } = useTranslation();
  const selected = routes.find(route => route.index === draft.routeIndex);
  const options = useMemo(() => {
    try {
      return { matches: httpMatchAlternatives(selected?.value.match), error: '' };
    } catch (error) {
      return {
        matches: [],
        error: error instanceof Error ? error.message : 'Unable to read match alternatives',
      };
    }
  }, [selected]);
  const current = options.matches[draft.matchIndex];
  return (
    <Stack spacing={2}>
      <HttpMatchEditWarning />
      {!!routes.length && (
        <TextField
          select
          label={t('HTTP route')}
          value={draft.routeIndex}
          disabled={disabled}
          onChange={event =>
            onChange(
              initialHttpMatchEdit(routes.find(route => route.index === Number(event.target.value)))
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
      {!options.matches.length && (
        <Alert severity="info">
          {t(
            'No editable match alternatives exist on this route. Use the specification editor to add or remove alternatives.'
          )}
        </Alert>
      )}
      {!!options.matches.length && (
        <>
          <TextField
            select
            label={t('Match alternative')}
            value={draft.matchIndex}
            disabled={disabled}
            onChange={event => {
              const matchIndex = Number(event.target.value);
              const match = options.matches[matchIndex];
              const field = HTTP_MATCH_FIELDS.find(field => match?.[field] !== undefined) ?? 'uri';
              onChange({
                ...draft,
                matchIndex,
                mode: 'keep',
                condition: existingHttpCondition(match, field),
              });
            }}
          >
            {options.matches.map((match, index) => (
              <MenuItem key={index} value={index}>
                {t('Alternative {{index}}', { index: index + 1 })}
                {typeof match.name === 'string' ? `: ${match.name}` : ''}
              </MenuItem>
            ))}
          </TextField>
          <CodeBlock
            value={JSON.stringify(current, null, 2)}
            label={t('Current match alternative')}
          />
          <HttpMatchConditionEditor
            condition={draft.condition}
            index={0}
            disabled={disabled}
            showValue={draft.mode !== 'remove'}
            onChange={condition =>
              onChange(
                condition.field !== draft.condition.field
                  ? {
                      ...draft,
                      mode: 'keep',
                      condition: existingHttpCondition(current, condition.field),
                    }
                  : { ...draft, condition }
              )
            }
          />
          <TextField
            select
            label={t('Match condition change')}
            value={draft.mode}
            disabled={disabled}
            onChange={event => {
              const mode = event.target.value;
              if (mode === 'keep' || mode === 'set' || mode === 'remove')
                onChange({ ...draft, mode });
            }}
          >
            <MenuItem value="keep">{t('Keep existing')}</MenuItem>
            <MenuItem value="set">{t('Set this condition')}</MenuItem>
            <MenuItem value="remove">{t('Remove this condition')}</MenuItem>
          </TextField>
        </>
      )}
      {(options.error || error) && <Alert severity="warning">{options.error || error}</Alert>}
    </Stack>
  );
}
