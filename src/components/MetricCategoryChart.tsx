import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { metricAxis, MetricChartType } from '../core/chartDisplay';
import { ComparisonMetric, metricCategoryData } from '../core/metricComparison';
import MetricAxisNotice from './MetricAxisNotice';
import { metricSeries, metricSeriesColors } from './metricSeries';

export default function MetricCategoryChart({
  metrics,
  title,
  unit,
  chartType = 'bar',
  height = 260,
  min,
  max,
}: {
  metrics: ComparisonMetric[];
  title: string;
  unit: string | null;
  chartType?: MetricChartType;
  height?: number;
  min?: number;
  max?: number;
}) {
  const { t } = useTranslation();
  let data: ReturnType<typeof metricCategoryData>;
  try {
    data = metricCategoryData(metrics);
  } catch (error) {
    return (
      <Alert severity="error">
        {error instanceof Error ? error.message : t('Series-category chart is unavailable')}
      </Alert>
    );
  }
  const unavailable = data.points.filter(point => point.value === null).length;
  let axis: ReturnType<typeof metricAxis> | undefined;
  let axisError: string | undefined;
  try {
    axis = metricAxis(
      data.points.map(point => point.value),
      { min, max }
    );
  } catch (error) {
    axisError = error instanceof Error ? error.message : t('Chart display bounds are unavailable');
  }
  const rows = data.points.map(point => ({
    ...point,
    ...Object.fromEntries(
      data.points.map(series => [series.key, series.key === point.key ? point.value : null])
    ),
  }));
  return (
    <Stack spacing={1}>
      <Typography variant="body2">
        {unit ? t('Unit: {{unit}}', { unit }) : t('Unit not specified by the chart definition.')}
      </Typography>
      {!unit && (
        <Typography variant="body2">
          {t('No unit is declared. Check metric dimensions before comparing these values.')}
        </Typography>
      )}
      <Typography>
        {t(
          'Series axis: each category shows its latest finite sample within the captured range, not necessarily the range end. Samples are not averaged or summed; missing values are not zero.'
        )}
      </Typography>
      {data.mixedTimes && (
        <Alert severity="warning">
          {t(
            'Selected sample times differ between series. This is not a synchronized instant or a health verdict.'
          )}
        </Alert>
      )}
      {unavailable > 0 && (
        <Alert severity="info">
          {t('Series without finite samples: {{count}}. They remain unavailable, not zero.', {
            count: unavailable,
          })}
        </Alert>
      )}
      {(chartType === 'line' || chartType === 'area') && (
        <Typography variant="body2">
          {t(
            'Line and area styles show isolated category points; different series are never joined by a line or filled region.'
          )}
        </Typography>
      )}
      <MetricAxisNotice min={min} max={max} outside={axis?.outside ?? 0} error={axisError} />
      {!axisError && unavailable < data.points.length && (
        <div role="img" aria-label={title}>
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="category" interval={0} />
              <YAxis {...(axis?.domain ? { domain: axis.domain, allowDataOverflow: true } : {})} />
              <Tooltip
                contentStyle={{
                  maxWidth: 'min(80vw, 480px)',
                  whiteSpace: 'normal',
                  overflowWrap: 'anywhere',
                }}
                labelFormatter={value => {
                  const point = data.points.find(point => point.category === Number(value));
                  return point
                    ? `${point.name} - ${
                        point.timestamp === null
                          ? t('Unavailable')
                          : new Date(point.timestamp * 1000).toLocaleString()
                      }`
                    : t('Unknown series');
                }}
              />
              {chartType === 'bar' ? (
                <Bar
                  dataKey="value"
                  name={unit || t('Value')}
                  maxBarSize={120}
                  isAnimationActive={false}
                >
                  {data.points.map(point => (
                    <Cell key={point.key} fill={metricSeriesColors[point.colorIndex]} />
                  ))}
                </Bar>
              ) : (
                data.points.map(point =>
                  metricSeries({
                    type: chartType,
                    name: point.name,
                    dataKey: point.key,
                    color: metricSeriesColors[point.colorIndex],
                    dot: { r: 3 },
                    animate: false,
                  })
                )
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <Stack
        component="ul"
        aria-label={t('Series categories')}
        spacing={0.5}
        sx={{ listStyle: 'none', pl: 0 }}
      >
        {data.points.map(point => (
          <Typography
            component="li"
            key={point.key}
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
                backgroundColor: metricSeriesColors[point.colorIndex],
              }}
            />
            {point.category}. {point.name}
            {point.value === null ? ` - ${t('Unavailable')}` : ''}
          </Typography>
        ))}
      </Stack>
      <details>
        <summary>{t('Show selected series samples')}</summary>
        <SimpleTable
          data={data.points}
          columns={[
            { label: t('Category'), getter: point => point.category },
            {
              label: t('Series'),
              getter: point => (
                <span style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{point.name}</span>
              ),
            },
            {
              label: t('Selected sample time'),
              getter: point =>
                point.timestamp === null
                  ? t('Unavailable')
                  : new Date(point.timestamp * 1000).toLocaleString(),
            },
            {
              label: unit || t('Value'),
              getter: point =>
                point.value === null ? t('Unavailable') : point.value.toPrecision(5),
            },
          ]}
        />
      </details>
    </Stack>
  );
}
