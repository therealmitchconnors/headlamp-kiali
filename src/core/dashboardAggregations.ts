import type { CustomDashboard } from './customDashboards';
import { compareGoStrings } from './goStrings';
import { metricGroupLabels } from './metricGroups';
import { isRecord } from './object';
import type { MetricResult } from './telemetry';

export interface DashboardAggregation {
  label: string;
  displayName: string;
  singleSelection?: boolean;
}
export interface AggregationValues extends DashboardAggregation {
  values: string[];
}
export type AggregationChoices = ReadonlyMap<string, ReadonlyMap<string, boolean>>;

export function validateDashboardAggregations(value: unknown): DashboardAggregation[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 8)
    throw new Error('A chart supports at most 8 aggregation declarations');
  return value.map(item => {
    if (
      !isRecord(item) ||
      Object.keys(item).some(key => !['label', 'displayName', 'singleSelection'].includes(key))
    )
      throw new Error(
        'Aggregation declarations support label, displayName and singleSelection only'
      );
    const label = metricGroupLabels([item.label])[0];
    if (
      typeof item.displayName !== 'string' ||
      !item.displayName.trim() ||
      item.displayName.length > 256 ||
      /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(item.displayName)
    )
      throw new Error(
        'Aggregation display names require bounded nonblank text without controls or unpaired surrogates'
      );
    if (
      item.singleSelection !== undefined &&
      item.singleSelection !== null &&
      typeof item.singleSelection !== 'boolean'
    )
      throw new Error('Aggregation singleSelection must be a boolean');
    return { label, displayName: item.displayName, singleSelection: item.singleSelection === true };
  });
}

export function dashboardAggregationOptions(dashboard: CustomDashboard): DashboardAggregation[] {
  const byDisplay = new Map<string, DashboardAggregation>();
  for (const { chart } of dashboard.items)
    for (const option of validateDashboardAggregations(chart.aggregations))
      byDisplay.set(option.displayName, option);
  if (byDisplay.size > 32)
    throw new Error('A dashboard supports at most 32 distinct aggregation choices');
  const byLabel = new Map<string, DashboardAggregation>();
  for (const option of [...byDisplay.values()].sort((a, b) =>
    compareGoStrings(a.displayName, b.displayName)
  )) {
    const existing = byLabel.get(option.label);
    if (existing && existing.singleSelection !== option.singleSelection)
      throw new Error('Aggregation aliases for the same label must agree on singleSelection');
    byLabel.set(option.label, option);
  }
  return [...byLabel.values()];
}

export function dashboardByLabels(value: unknown, dashboard: CustomDashboard): string[] {
  const names = metricGroupLabels(value);
  const options = dashboardAggregationOptions(dashboard);
  if (names.some(name => !options.some(option => option.label === name)))
    throw new Error(
      'Optional grouping labels must be declared in this dashboard aggregations list'
    );
  return names;
}

export function aggregationValueOptions(
  dashboard: CustomDashboard,
  results: readonly MetricResult[]
): AggregationValues[] {
  if (
    results.length > 8 ||
    results.some(
      result =>
        result.series.length > 8 ||
        result.series.some(series => Object.keys(series.labels).length > 4)
    )
  )
    throw new Error('Aggregation filters exceed the captured result budget');
  return dashboardAggregationOptions(dashboard).map(option => {
    const values = new Set<string>();
    for (const result of results)
      for (const series of result.series) {
        if (Object.prototype.hasOwnProperty.call(series.labels, option.label)) {
          const value = series.labels[option.label];
          if (typeof value !== 'string' || value.length > 256 || /[\ud800-\udfff]/u.test(value))
            throw new Error('Aggregation values require bounded literal strings');
          values.add(value);
        }
      }
    if (values.size > 64) throw new Error('Aggregation filters exceed 64 values per label');
    return { ...option, values: [...values] };
  });
}

export function initialAggregationChoices(
  options: readonly AggregationValues[]
): AggregationChoices {
  return new Map(
    options.map(option => [
      option.label,
      new Map(option.values.map((value, index) => [value, !option.singleSelection || index === 0])),
    ])
  );
}

export function selectAggregationValue(
  choices: AggregationChoices,
  option: AggregationValues,
  value: string,
  checked: boolean
): AggregationChoices {
  const previous = choices.get(option.label);
  if (!previous || !previous.has(value) || !option.values.includes(value))
    throw new Error('Choose a label value from the captured result');
  const selected = new Map(previous);
  if (option.singleSelection) {
    if (!checked) throw new Error('A single-selection aggregation requires a selected value');
    for (const key of selected.keys()) selected.set(key, false);
  }
  selected.set(value, checked);
  return new Map([...choices, [option.label, selected]]);
}

export function filterAggregationValues(
  result: MetricResult,
  choices: AggregationChoices
): MetricResult {
  return {
    ...result,
    series: result.series.filter(series =>
      Object.entries(series.labels).every(
        ([name, value]) => choices.get(name)?.get(value) !== false
      )
    ),
  };
}
