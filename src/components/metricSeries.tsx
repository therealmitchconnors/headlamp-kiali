import { Area, Bar, Line } from 'recharts';
import type { MetricChartType } from '../core/chartDisplay';

export const metricSeriesColors = [
  '#1976d2',
  '#9c27b0',
  '#ed6c02',
  '#00838f',
  '#c62828',
  '#546e7a',
  '#6d4c41',
  '#4527a0',
];

export function metricSeries({
  type,
  name,
  dataKey,
  color,
  dot,
  animate,
}: {
  type: MetricChartType;
  name: string;
  dataKey: string;
  color: string;
  dot: boolean | { r: number };
  animate?: boolean;
}) {
  const identity = { dataKey, name };
  if (type === 'bar')
    return <Bar key={dataKey} {...identity} fill={color} isAnimationActive={false} />;
  if (type === 'area')
    return (
      <Area
        key={dataKey}
        {...identity}
        stroke={color}
        fill={color}
        fillOpacity={0.2}
        dot={dot}
        connectNulls={false}
        isAnimationActive={false}
      />
    );
  if (type === 'scatter')
    return (
      <Line
        key={dataKey}
        {...identity}
        stroke="none"
        dot={{ r: 3, stroke: color, fill: color }}
        activeDot={{ r: 4, stroke: color, fill: color }}
        legendType="circle"
        connectNulls={false}
        isAnimationActive={false}
      />
    );
  return (
    <Line
      key={dataKey}
      {...identity}
      stroke={color}
      dot={dot}
      connectNulls={false}
      isAnimationActive={animate}
    />
  );
}
