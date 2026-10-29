import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import { ChartDisplay } from '../core/chartDisplay';

export default function MetricAxisNotice({
  min,
  max,
  outside,
  error,
}: Pick<ChartDisplay, 'min' | 'max'> & { outside: number; error?: string }) {
  const { t } = useTranslation();
  return (
    <>
      {(min !== undefined || max !== undefined) && (
        <Typography variant="body2">
          {t(
            'Display bounds: minimum {{minimum}}; maximum {{maximum}}. Numeric values remain unchanged.',
            {
              minimum: min ?? t('Automatic'),
              maximum: max ?? t('Automatic'),
            }
          )}
        </Typography>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {outside > 0 && (
        <Alert severity="warning">
          {t(
            'Samples outside the display bounds: {{count}}. Inspect the numeric values below; no values have been clamped or replaced.',
            { count: outside }
          )}
        </Alert>
      )}
    </>
  );
}
