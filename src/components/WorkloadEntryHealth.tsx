import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { WorkloadEntryHealthRead } from '../core/workloadEntryHealth';

export default function WorkloadEntryHealth({ health }: { health: WorkloadEntryHealthRead }) {
  const { t } = useTranslation();
  if (health.ok === false)
    return (
      <Alert severity="warning">
        {t('Probe evidence unavailable: {{message}}', { message: health.message })}
      </Alert>
    );
  const evidence = health.evidence;
  const summary =
    evidence.basis === 'disabled-checks'
      ? t('Assumed available by Kiali; health checks disabled')
      : evidence.basis === 'invalid-annotation'
      ? t('Assumed available by Kiali; unrecognized health annotation')
      : evidence.basis === 'missing-condition'
      ? t('Not available in Kiali; Healthy condition missing')
      : evidence.basis === 'unknown-condition'
      ? t('Not available in Kiali; Healthy condition is not True or False')
      : evidence.kialiAvailable
      ? t('Reported Healthy condition: True')
      : t('Reported Healthy condition: False');
  return (
    <Box sx={{ overflowWrap: 'anywhere' }}>
      <Typography variant="body2">{summary}</Typography>
      <details>
        <summary>{t('Show reported probe fields')}</summary>
        <Typography variant="body2">
          {t('Health-check annotation: {{value}}', {
            value:
              evidence.annotation === undefined
                ? t('Not reported')
                : evidence.annotation === ''
                ? t('Empty')
                : evidence.annotation,
          })}
        </Typography>
        {evidence.condition && (
          <>
            <Typography variant="body2">
              {t('First Healthy condition status: {{value}}', {
                value: evidence.condition.status || t('Empty'),
              })}
            </Typography>
            {evidence.condition.reason && (
              <Typography variant="body2">
                {t('Reason: {{value}}', { value: evidence.condition.reason })}
              </Typography>
            )}
            {evidence.condition.message && (
              <Typography variant="body2">
                {t('Message: {{value}}', { value: evidence.condition.message })}
              </Typography>
            )}
            <Typography variant="body2">
              {t('Last reported probe: {{time}}', {
                time: evidence.condition.lastProbeTime ?? t('Not reported'),
              })}
            </Typography>
            <Typography variant="body2">
              {t('Last reported transition: {{time}}', {
                time: evidence.condition.lastTransitionTime ?? t('Not reported'),
              })}
            </Typography>
          </>
        )}
      </details>
    </Box>
  );
}
