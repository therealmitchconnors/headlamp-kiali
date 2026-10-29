export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function editableObject(value: unknown, field: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value))
    throw new Error(`Existing ${field} is malformed; use the specification editor`);
  return { ...value };
}

export function isDnsLabel(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.exec(value)?.[0] === value
  );
}

export function isDnsSubdomain(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 253 && value.split('.').every(isDnsLabel);
}
