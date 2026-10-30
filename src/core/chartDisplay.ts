import { isRecord } from './object';

export type MetricChartType = 'line' | 'area' | 'bar' | 'scatter';
export type MetricChartAxis = 'time' | 'series';

export function validateMetricChartAxis(value: unknown): MetricChartAxis | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'time' || value === 'series') return value;
  throw new Error('Chart xAxis must be time or series');
}

export function validateMetricChartType(value: unknown): MetricChartType | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === '') return 'line';
  if (value === 'line' || value === 'area' || value === 'bar' || value === 'scatter') return value;
  throw new Error('Chart type must be line, area, bar or scatter');
}

export interface ChartDisplay {
  min?: number;
  max?: number;
  spans?: number;
}

export function validateChartDisplay(value: unknown): ChartDisplay {
  if (!isRecord(value)) throw new Error('Chart display settings must be an object');
  const bound = (name: 'min' | 'max') => {
    const result = value[name];
    if (result === undefined || result === null) return undefined;
    if (typeof result !== 'number' || !Number.isSafeInteger(result))
      throw new Error('Chart min and max require safe integer display bounds');
    return result;
  };
  const min = bound('min');
  const max = bound('max');
  if (min !== undefined && max !== undefined && min >= max)
    throw new Error('Chart minimum must be lower than its maximum');
  let spans: number | undefined;
  const rawSpans = value.spans;
  if (rawSpans !== undefined && rawSpans !== null && rawSpans !== 0) {
    if (
      typeof rawSpans !== 'number' ||
      !Number.isInteger(rawSpans) ||
      rawSpans < 1 ||
      rawSpans > 12
    )
      throw new Error('Chart spans must be an integer from 1 to 12, or zero for full width');
    spans = rawSpans;
  }
  return {
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(spans !== undefined ? { spans } : {}),
  };
}

export function metricAxis(
  values: readonly (number | null)[],
  bounds: Pick<ChartDisplay, 'min' | 'max'>
): { domain?: [number, number]; outside: number } {
  const { min, max } = validateChartDisplay(bounds);
  const anchor = min ?? max;
  if (anchor === undefined) return { outside: 0 };
  if (values.length > 1928 || values.some(value => value !== null && !Number.isFinite(value)))
    throw new Error('Chart display bounds require at most 1928 finite or unavailable samples');
  const finite = values.filter((value): value is number => value !== null);
  let low = min ?? Math.min(anchor, ...finite);
  let high = max ?? Math.max(anchor, ...finite);
  // Only an unspecified edge may expand when all samples lie outside the declared bound.
  if (low >= high) {
    const padding = Math.max(1, Math.abs(anchor) * 0.01);
    if (min === undefined) low = high - padding;
    else high = low + padding;
  }
  const span = high - low;
  if (
    !Number.isFinite(span) ||
    span <= 0 ||
    finite.some(value => !Number.isFinite(((value - low) / span) * 4096))
  )
    throw new Error(
      'Display bounds cannot represent these samples safely; widen or remove the bounds'
    );
  return {
    domain: [low, high],
    outside: finite.filter(
      value => (min !== undefined && value < min) || (max !== undefined && value > max)
    ).length,
  };
}
