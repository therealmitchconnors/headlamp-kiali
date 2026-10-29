import { TracingConfig } from './config';
import { isRecord } from './object';
import { TraceWindow, validTraceWindow } from './tracing';

export type TraceNameQuery = TraceWindow &
  ({ kind: 'services' } | { kind: 'operations'; service: string });

function validName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    value.length <= 256 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function traceNamesPath(provider: TracingConfig['provider'], query: TraceNameQuery): string {
  if (
    !['jaeger', 'tempo'].includes(provider) ||
    !['services', 'operations'].includes(query.kind) ||
    !validTraceWindow(query)
  )
    throw new Error(
      'Trace name discovery requires a provider, a name kind and a range up to 24 hours'
    );
  if (query.kind === 'operations' && !validName(query.service))
    throw new Error(
      'Operation discovery requires a service name up to 256 characters without control characters'
    );
  if (provider === 'jaeger')
    return query.kind === 'services'
      ? '/api/services'
      : `/api/operations?${new URLSearchParams({ service: query.service })}`;
  const params = new URLSearchParams({
    start: String(query.start),
    end: String(query.end),
    limit: '1000',
  });
  if (query.kind === 'operations')
    params.set('q', `{ .service.name = ${JSON.stringify(query.service)} }`);
  const tag = query.kind === 'services' ? '.service.name' : 'name';
  return `/api/v2/search/tag/${tag}/values?${params}`;
}

export function decodeTraceNames(
  provider: TracingConfig['provider'],
  kind: TraceNameQuery['kind'],
  response: unknown
): string[] {
  if (
    !['jaeger', 'tempo'].includes(provider) ||
    !['services', 'operations'].includes(kind) ||
    !isRecord(response)
  )
    throw new Error('Invalid trace name response');
  if (response.errors !== undefined && response.errors !== null) {
    if (!Array.isArray(response.errors) || response.errors.length)
      throw new Error('Tracing backend reported name discovery errors');
  }
  const entries = provider === 'jaeger' ? response.data : response.tagValues;
  if (!Array.isArray(entries) || entries.length > 1000)
    throw new Error('Trace name response must contain at most 1,000 entries');
  const names = entries.map((entry: unknown) => {
    const name =
      provider === 'tempo'
        ? isRecord(entry) && entry.type === 'string'
          ? entry.value
          : undefined
        : kind === 'operations'
        ? isRecord(entry)
          ? entry.name
          : undefined
        : entry;
    if (!validName(name))
      throw new Error(
        'Trace names must be nonempty strings up to 256 characters without control characters'
      );
    return name;
  });
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}
