import type { Labels } from './labels';
import { isRecord } from './object';

export function workloadLabelBudget() {
  let characters = 0;
  return (labels: Labels) => {
    characters += Object.entries(labels).reduce(
      (sum, [key, value]) => sum + key.length + value.length,
      0
    );
    if (characters > 1000000)
      throw new Error('Workload label context exceeds 1,000,000 characters');
  };
}

export function workloadEntryLabels(value: unknown): Labels {
  if (value === undefined || value === null) return {};
  if (!isRecord(value) || Object.keys(value).length > 256)
    throw new Error('Workload labels require an object with at most 256 entries');
  for (const [key, label] of Object.entries(value))
    if (!key || key.length > 1024 || typeof label !== 'string' || label.length > 1024)
      throw new Error('Workload label names and string values are limited to 1024 characters');
  return Object.fromEntries(Object.entries(value).map(([key, label]) => [key, String(label)]));
}

export function workloadGroupEntrySelector(spec: unknown): Labels | null {
  if (!isRecord(spec)) throw new Error('WorkloadGroup specification is unavailable');
  const metadata = spec.metadata;
  if (metadata === undefined || metadata === null) return null;
  if (!isRecord(metadata)) throw new Error('WorkloadGroup template metadata is malformed');
  if (metadata.labels === undefined || metadata.labels === null) return null;
  return workloadEntryLabels(metadata.labels);
}

export function workloadEntryMatches(selector: Labels, labels: Labels): boolean {
  const entries = Object.entries(selector);
  // Kiali's FilterWorkloadEntriesBySelector deliberately excludes empty selectors.
  return (
    entries.length > 0 &&
    entries.every(
      ([key, value]) => Object.prototype.hasOwnProperty.call(labels, key) && labels[key] === value
    )
  );
}
