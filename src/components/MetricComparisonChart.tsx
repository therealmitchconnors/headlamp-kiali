import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ComparisonMetric, metricComparisonData } from '../core/metricComparison';

const colors = [
  '#1976d2',
  '#9c27b0',
  '#ed6c02',
  '#00838f',
  '#c62828',
  '#546e7a',
  '#6d4c41',
  '#4527a0',
];
export default function MetricComparisonChart({
  metrics,
  title,
  unit,
}: {
  metrics: ComparisonMetric[];
  title: string;
  unit: string;
}) {
  const { t } = useTranslation();
  const grouped = metrics.some(metric => metric.group !== undefined);
  let data: ReturnType<typeof metricComparisonData>;
  try {
    data = metricComparisonData(metrics);
  } catch (error) {
    return (
      <Alert severity="error">
        {error instanceof Error ? error.message : t('Metric comparison is unavailable')}
      </Alert>
    );
  }
  if (!data.rows.some(row => data.series.some(series => row[series.key] !== null)))
    return (
      <Alert severity="info">
        {t('Samples are unavailable or non-finite. No zero values have been substituted.')}
      </Alert>
    );
  return (
    <Stack spacing={1}>
      <Typography variant="body2">{t('Unit: {{unit}}', { unit })}</Typography>
      <Typography variant="body2">
        {t(
          'Metrics share the declared chart unit. Missing timestamps stay gaps; lines are not summed or extrapolated.'
        )}
      </Typography>
      <div role="img" aria-label={title}>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data.rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="timestamp"
              tickFormatter={value => new Date(Number(value) * 1000).toLocaleTimeString()}
            />
            <YAxis />
            <Tooltip
              labelFormatter={value => new Date(Number(value) * 1000).toLocaleTimeString()}
            />
            {!grouped && <Legend />}
            {data.series.map(series => (
              <Line
                key={series.key}
                name={series.name}
                dataKey={series.key}
                stroke={colors[series.colorIndex]}
                dot={{ r: 2 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {grouped && (
        <Stack
          component="ul"
          aria-label={t('Grouped metric series')}
          spacing={0.5}
          sx={{ listStyle: 'none', pl: 0 }}
        >
          {data.series.map(series => (
            <Typography
              component="li"
              key={series.key}
              variant="body2"
              sx={{ overflowWrap: 'anywhere' }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-block',
                  width: 16,
                  height: 3,
                  marginRight: 8,
                  backgroundColor: colors[series.colorIndex],
                }}
              />
              {series.name}
            </Typography>
          ))}
        </Stack>
      )}
      <details>
        <summary>{t('Show compared metric values')}</summary>
        <SimpleTable
          data={data.rows}
          columns={[
            {
              label: t('Time'),
              getter: row => (
                <span style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                  {new Date(row.timestamp * 1000).toLocaleString()}
                </span>
              ),
            },
            ...data.series.map(series => ({
              label: series.name,
              getter: (row: (typeof data.rows)[number]) => {
                const value = row[series.key];
                return value === null ? t('Unavailable') : value.toPrecision(5);
              },
            })),
          ]}
        />
      </details>
    </Stack>
  );
}
