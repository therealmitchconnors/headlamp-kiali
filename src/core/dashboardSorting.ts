import { compareGoStrings } from './goStrings';
import { metricGroupIdentity, metricGroupLabels } from './metricGroups';
import type { MetricResult } from './telemetry';

export interface DashboardSorting {
  sortLabel?: string;
  sortLabelParseAs?: 'int';
}

export function validateDashboardSorting(
  value: { sortLabel?: unknown; sortLabelParseAs?: unknown },
  histogram = false
): DashboardSorting {
  const label = value.sortLabel;
  const parse = value.sortLabelParseAs;
  const sortLabel =
    label === undefined || label === null || label === ''
      ? undefined
      : metricGroupLabels([label], histogram)[0];
  if (parse !== undefined && parse !== null && parse !== '' && parse !== 'int')
    throw new Error('Dashboard sortLabelParseAs supports int or an omitted lexical mode');
  if (parse === 'int' && !sortLabel)
    throw new Error('Integer dashboard sorting requires a sortLabel');
  return {
    ...(sortLabel ? { sortLabel } : {}),
    ...(parse === 'int' ? { sortLabelParseAs: parse } : {}),
  };
}

function integer(value: string) {
  if (/^[+-]?[0-9]+$/.exec(value)?.[0] !== value)
    throw new Error('Integer dashboard sort values must be signed base-ten 64-bit integers');
  const magnitude = value.replace(/^[+-]/, '').replace(/^0+/, '') || '0';
  const negative = value[0] === '-' && magnitude !== '0';
  const bound = negative ? '9223372036854775808' : '9223372036854775807';
  if (magnitude.length > bound.length || (magnitude.length === bound.length && magnitude > bound))
    throw new Error('Integer dashboard sort values exceed the signed 64-bit range');
  return { magnitude, negative };
}

export function sortDashboardSeries(
  result: MetricResult,
  sorting: DashboardSorting,
  displayedLabels: readonly string[]
): MetricResult {
  const { sortLabel, sortLabelParseAs } = validateDashboardSorting(sorting);
  if (!sortLabel) return result;
  const groups = metricGroupLabels(displayedLabels);
  const queryGroups = groups.includes(sortLabel)
    ? groups
    : metricGroupLabels([...groups, sortLabel]);
  if (result.series.length > 8) throw new Error('Dashboard sorting exceeds eight captured series');
  const entries = result.series.map(series => {
    metricGroupIdentity(series.labels, queryGroups);
    const value = Object.prototype.hasOwnProperty.call(series.labels, sortLabel)
      ? series.labels[sortLabel]
      : '';
    return { series, value, parsed: sortLabelParseAs === 'int' ? integer(value) : undefined };
  });
  entries.sort((a, b) => {
    if (!a.parsed || !b.parsed) return compareGoStrings(a.value, b.value);
    if (a.parsed.negative !== b.parsed.negative) return a.parsed.negative ? -1 : 1;
    const comparison =
      a.parsed.magnitude.length - b.parsed.magnitude.length ||
      compareGoStrings(a.parsed.magnitude, b.parsed.magnitude);
    return a.parsed.negative ? -comparison : comparison;
  });
  const series = entries.map(({ series }) => ({
    ...series,
    labels: Object.fromEntries(
      Object.entries(series.labels).filter(
        ([label]) => label !== sortLabel || groups.includes(sortLabel)
      )
    ),
  }));
  const keys = series.map(item => metricGroupIdentity(item.labels, groups).key);
  if (new Set(keys).size !== keys.length)
    throw new Error(
      'Removing the sort-only label makes displayed series indistinguishable; include sortLabel in groupLabels or narrow the filters'
    );
  return { ...result, series };
}
