import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { MetricResult } from '../core/telemetry';

export default function MetricChart({
  result,
  title,
  unit,
  seriesName,
}: {
  result: MetricResult;
  title: string;
  unit: string;
  seriesName?: string;
}) {
  const { t } = useTranslation();
  const points = result.series.flatMap(series => series.samples);
  const available = points.reduce((count, point) => count + (point.value === null ? 0 : 1), 0);
  if (!available)
    return (
      <Alert severity="info">
        {t('Samples are unavailable or non-finite. No zero values have been substituted.')}
      </Alert>
    );
  return (
    <Stack spacing={1}>
      <Typography variant="body2">{t('Unit: {{unit}}', { unit })}</Typography>
      <div role="img" aria-label={title}>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={points}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="timestamp"
              tickFormatter={value => new Date(Number(value) * 1000).toLocaleTimeString()}
            />
            <YAxis />
            <Tooltip
              labelFormatter={value => new Date(Number(value) * 1000).toLocaleTimeString()}
            />
            <Line
              name={seriesName ?? unit}
              dataKey="value"
              dot={available === 1}
              connectNulls={false}
              stroke="#1976d2"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details>
        <summary>{t('Show metric values')}</summary>
        <SimpleTable
          data={points}
          columns={[
            {
              label: t('Time'),
              getter: (point: { timestamp: number }) =>
                new Date(point.timestamp * 1000).toLocaleString(),
            },
            {
              label: unit,
              getter: (point: { value: number | null }) =>
                point.value === null ? t('Unavailable') : point.value.toPrecision(5),
            },
          ]}
        />
      </details>
    </Stack>
  );
}
