import { isRecord } from './object';
import {
  TempoAttributeFilter,
  TRACE_ATTRIBUTE_OPERATORS,
  traceAttributeOperatorAllowed,
  traceStringLiteral,
} from './traceFilters';

export const TEMPO_SPAN_INTRINSICS = [
  'name',
  'statusMessage',
  'duration',
  'status',
  'kind',
] as const;
export const TEMPO_TRACE_INTRINSICS = ['traceDuration', 'rootName', 'rootServiceName'] as const;
export const TEMPO_METADATA_INTRINSICS = [
  'eventName',
  'instrumentationName',
  'instrumentationVersion',
] as const;
export const TEMPO_ID_INTRINSICS = [
  'traceId',
  'spanId',
  'parentId',
  'linkTraceId',
  'linkSpanId',
] as const;
export const TEMPO_INTRINSICS = [
  ...TEMPO_SPAN_INTRINSICS,
  ...TEMPO_TRACE_INTRINSICS,
  ...TEMPO_METADATA_INTRINSICS,
  'eventTimeSinceStart',
  ...TEMPO_ID_INTRINSICS,
] as const;
export const TEMPO_SPAN_STATUSES = ['ok', 'error', 'unset'] as const;
export const TEMPO_SPAN_KINDS = [
  'unspecified',
  'internal',
  'server',
  'client',
  'producer',
  'consumer',
] as const;
export interface TempoIntrinsicFilter {
  field: (typeof TEMPO_INTRINSICS)[number];
  operator: TempoAttributeFilter['operator'];
  value: string;
}

export function traceIntrinsicIdWidth(field: TempoIntrinsicFilter['field']): 16 | 32 | undefined {
  if (field === 'traceId' || field === 'linkTraceId') return 32;
  if (field === 'spanId' || field === 'parentId' || field === 'linkSpanId') return 16;
  return undefined;
}

export function traceIntrinsicIsDuration(field: TempoIntrinsicFilter['field']): boolean {
  return field === 'duration' || field === 'traceDuration' || field === 'eventTimeSinceStart';
}

export function traceIntrinsicOperatorAllowed(
  field: TempoIntrinsicFilter['field'],
  operator: TempoIntrinsicFilter['operator']
): boolean {
  return traceAttributeOperatorAllowed(
    field === 'status' || field === 'kind' || traceIntrinsicIdWidth(field) !== undefined
      ? 'boolean'
      : traceIntrinsicIsDuration(field)
      ? 'integer'
      : 'string',
    operator
  );
}

export function traceIntrinsicName(field: TempoIntrinsicFilter['field']): string {
  if (field === 'traceDuration') return 'trace:duration';
  if (field === 'rootName') return 'trace:rootName';
  if (field === 'rootServiceName') return 'trace:rootService';
  if (field === 'eventName') return 'event:name';
  if (field === 'eventTimeSinceStart') return 'event:timeSinceStart';
  if (field === 'instrumentationName') return 'instrumentation:name';
  if (field === 'instrumentationVersion') return 'instrumentation:version';
  if (field === 'traceId') return 'trace:id';
  if (field === 'spanId') return 'span:id';
  if (field === 'parentId') return 'span:parentID';
  if (field === 'linkTraceId') return 'link:traceID';
  if (field === 'linkSpanId') return 'link:spanID';
  return `span:${field}`;
}

function durationLiteral(value: string, scope: 'Span' | 'Trace' | 'Event'): string {
  const signed = scope === 'Event';
  const negative = signed && value.startsWith('-');
  const magnitude = negative ? value.slice(1) : value;
  const label = signed ? 'Event offset' : `${scope} duration`;
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?(ns|us|ms|s|m|h)$/.exec(magnitude);
  if (value.length > 64 || !match || match[0] !== magnitude)
    throw new Error(
      `${label} requires a ${
        signed ? 'signed' : 'nonnegative'
      } single-unit value: ns, us, ms, s, m or h`
    );
  const units: Record<string, bigint> = {
    ns: BigInt(1),
    us: BigInt(1000),
    ms: BigInt(1000000),
    s: BigInt(1000000000),
    m: BigInt(60000000000),
    h: BigInt(3600000000000),
  };
  const fraction = match[2] ?? '';
  const divisor = BigInt(10) ** BigInt(fraction.length);
  const numerator = BigInt(match[1] + fraction) * units[match[3]];
  if (numerator % divisor !== BigInt(0))
    throw new Error(`${label} must have whole-nanosecond precision; values are not rounded`);
  const nanoseconds = numerator / divisor;
  if (nanoseconds > BigInt('9223372036854775807'))
    throw new Error(
      signed
        ? 'Event offset magnitude exceeds 9223372036854775807ns; a larger duration token cannot be serialized exactly'
        : `${label} exceeds signed 64-bit nanoseconds`
    );
  return `${negative && nanoseconds !== BigInt(0) ? '-' : ''}${nanoseconds}ns`;
}

export function tempoIntrinsicClauses(filters: readonly TempoIntrinsicFilter[] = []): string[] {
  if (!Array.isArray(filters) || filters.length > 10)
    throw new Error('Trace search supports at most 10 Tempo intrinsic filters');
  return filters.map(filter => {
    if (!isRecord(filter)) throw new Error('Invalid Tempo intrinsic filter');
    const field = TEMPO_INTRINSICS.find(field => field === filter.field);
    const operator = TRACE_ATTRIBUTE_OPERATORS.find(operator => operator === filter.operator);
    if (!field || !operator || !traceIntrinsicOperatorAllowed(field, operator))
      throw new Error('Unsupported Tempo intrinsic field or comparison operator');
    if (typeof filter.value !== 'string' || filter.value.length > 1024)
      throw new Error('Intrinsic values must be strings of at most 1024 characters');
    const idWidth = traceIntrinsicIdWidth(field);
    let literal: string;
    if (idWidth !== undefined) {
      if (filter.value.length > idWidth || /[^0-9a-f]/i.test(filter.value))
        throw new Error(
          `Trace intrinsic IDs require at most ${idWidth} hexadecimal characters, without prefixes or whitespace`
        );
      literal = JSON.stringify(filter.value);
    } else if (field === 'status' || field === 'kind') {
      const values: readonly string[] = field === 'status' ? TEMPO_SPAN_STATUSES : TEMPO_SPAN_KINDS;
      if (!values.includes(filter.value))
        throw new Error(`Span ${field} requires one of: ${values.join(', ')}`);
      literal = filter.value;
    } else if (traceIntrinsicIsDuration(field))
      literal = durationLiteral(
        filter.value,
        field === 'duration' ? 'Span' : field === 'traceDuration' ? 'Trace' : 'Event'
      );
    else literal = traceStringLiteral(filter.value, operator);
    return `${traceIntrinsicName(field)} ${operator} ${literal}`;
  });
}
