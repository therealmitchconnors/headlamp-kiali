import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { ValidationExclusionDraft } from '../../core/validationAnnotations';

export default function ValidationExclusionsEditor({
  draft,
  onChange,
  disabled,
  error,
}: {
  draft: ValidationExclusionDraft;
  onChange: (draft: ValidationExclusionDraft) => void;
  disabled: boolean;
  error?: string;
}) {
  const { t } = useTranslation();
  return (
    <Stack spacing={2}>
      <TextField
        select
        label={t('Validation exclusion mode')}
        value={draft.mode}
        disabled={disabled}
        onChange={event => {
          const mode = event.target.value;
          if (mode === 'none' || mode === 'codes' || mode === 'all') onChange({ ...draft, mode });
        }}
      >
        <MenuItem value="none">{t('Restore normal checks')}</MenuItem>
        <MenuItem value="codes">{t('Ignore selected codes')}</MenuItem>
        <MenuItem value="all">{t('Ignore all findings for this object')}</MenuItem>
      </TextField>
      {draft.mode === 'codes' && (
        <TextField
          label={t('Validation codes (comma-separated)')}
          value={draft.codes}
          disabled={disabled}
          inputProps={{ maxLength: 4096 }}
          helperText={t('Use up to 100 KIA#### or GWAPI codes. Matching is case-sensitive.')}
          onChange={event => onChange({ ...draft, codes: event.target.value })}
        />
      )}
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  );
}
