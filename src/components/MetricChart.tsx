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
import { metricAxis } from '../core/chartDisplay';
import { MetricResult } from '../core/telemetry';
import MetricAxisNotice from './MetricAxisNotice';

export default function MetricChart({
  result,
  title,
  unit,
  seriesName,
  min,
  max,
}: {
  result: MetricResult;
  title: string;
  unit: string | null;
  seriesName?: string;
  min?: number;
  max?: number;
}) {
  const { t } = useTranslation();
  const points = result.series.flatMap(series => series.samples);
  const available = points.reduce((count, point) => count + (point.value === null ? 0 : 1), 0);
  let axis: ReturnType<typeof metricAxis> | undefined;
  let axisError: string | undefined;
  try {
    axis = metricAxis(
      points.map(point => point.value),
      { min, max }
    );
  } catch (error) {
    axisError = error instanceof Error ? error.message : t('Chart display bounds are unavailable');
  }
  if (!available)
    return (
      <Alert severity="info">
        {t('Samples are unavailable or non-finite. No zero values have been substituted.')}
      </Alert>
    );
  return (
    <Stack spacing={1}>
      <Typography variant="body2">
        {unit ? t('Unit: {{unit}}', { unit }) : t('Unit not specified by the chart definition.')}
      </Typography>
      <MetricAxisNotice min={min} max={max} outside={axis?.outside ?? 0} error={axisError} />
      {!axisError && (
        <div role="img" aria-label={title}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={points}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={value => new Date(Number(value) * 1000).toLocaleTimeString()}
              />
              <YAxis {...(axis?.domain ? { domain: axis.domain, allowDataOverflow: true } : {})} />
              <Tooltip
                labelFormatter={value => new Date(Number(value) * 1000).toLocaleTimeString()}
              />
              <Line
                name={seriesName ?? (unit || t('Value'))}
                dataKey="value"
                dot={available === 1}
                connectNulls={false}
                stroke="#1976d2"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <details>
        <summary>{t('Show metric values')}</summary>
        <SimpleTable
          data={points}
          columns={[
            {
              label: t('Time'),
              getter: (point: { timestamp: number }) => (
                <span style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                  {new Date(point.timestamp * 1000).toLocaleString()}
                </span>
              ),
            },
            {
              label: unit || t('Value'),
              getter: (point: { value: number | null }) =>
                point.value === null ? t('Unavailable') : point.value.toPrecision(5),
            },
          ]}
        />
      </details>
    </Stack>
  );
}
