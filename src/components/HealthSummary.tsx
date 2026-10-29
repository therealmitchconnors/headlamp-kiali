import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { StatusLabel } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import { CalculatedHealth } from '../core/healthCalculator';

export default function HealthSummary({
  calculation,
  label,
  includesReplicas = false,
}: {
  calculation: CalculatedHealth;
  label: string;
  includesReplicas?: boolean;
}) {
  const { t } = useTranslation();
  const labels = {
    Healthy: t('Healthy'),
    Degraded: t('Degraded'),
    Failure: t('Failure'),
    'Not Ready': t('Not Ready'),
    NA: t('Not assessed'),
  };
  return (
    <>
      <StatusLabel
        status={
          calculation.status === 'Healthy'
            ? 'success'
            : calculation.status === 'Failure'
            ? 'error'
            : 'warning'
        }
      >
        {includesReplicas && calculation.totalRequestRate === 0
          ? t('Replica health (requests not assessed)')
          : label}
        : {labels[calculation.status]}
      </StatusLabel>
      {calculation.totalRequestRate === 0 && (
        <Alert severity="info">
          {t(
            'No positive request rates were observed. Request errors cannot be assessed from zero traffic.'
          )}
        </Alert>
      )}
      <Typography>
        {t('Total observed requests / second')}: {calculation.totalRequestRate.toPrecision(5)}
      </Typography>
      <Typography>
        {t('Error percentage for the worst matching tolerance')}:{' '}
        {calculation.errorRatio < 0 ? t('Unavailable') : calculation.errorRatio.toFixed(2)}
      </Typography>
      {calculation.warnings.map((warning, index) => (
        <Alert severity="warning" key={index}>
          {warning}
        </Alert>
      ))}
    </>
  );
}
