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
export const TEMPO_INTRINSICS = [...TEMPO_SPAN_INTRINSICS, ...TEMPO_TRACE_INTRINSICS] as const;
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

export function traceIntrinsicOperatorAllowed(
  field: TempoIntrinsicFilter['field'],
  operator: TempoIntrinsicFilter['operator']
): boolean {
  return traceAttributeOperatorAllowed(
    field === 'status' || field === 'kind'
      ? 'boolean'
      : field === 'duration' || field === 'traceDuration'
      ? 'integer'
      : 'string',
    operator
  );
}

export function traceIntrinsicName(field: TempoIntrinsicFilter['field']): string {
  if (field === 'traceDuration') return 'trace:duration';
  if (field === 'rootName') return 'trace:rootName';
  if (field === 'rootServiceName') return 'trace:rootService';
  return `span:${field}`;
}

function durationLiteral(value: string, scope: 'Span' | 'Trace'): string {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?(ns|us|ms|s|m|h)$/.exec(value);
  if (value.length > 64 || !match || match[0] !== value)
    throw new Error(
      `${scope} duration requires a nonnegative single-unit value: ns, us, ms, s, m or h`
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
    throw new Error(
      `${scope} duration must have whole-nanosecond precision; values are not rounded`
    );
  const nanoseconds = numerator / divisor;
  if (nanoseconds > BigInt('9223372036854775807'))
    throw new Error(`${scope} duration exceeds signed 64-bit nanoseconds`);
  return `${nanoseconds}ns`;
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
    let literal: string;
    if (field === 'status' || field === 'kind') {
      const values: readonly string[] = field === 'status' ? TEMPO_SPAN_STATUSES : TEMPO_SPAN_KINDS;
      if (!values.includes(filter.value))
        throw new Error(`Span ${field} requires one of: ${values.join(', ')}`);
      literal = filter.value;
    } else if (field === 'duration' || field === 'traceDuration')
      literal = durationLiteral(filter.value, field === 'duration' ? 'Span' : 'Trace');
    else literal = traceStringLiteral(filter.value, operator);
    return `${traceIntrinsicName(field)} ${operator} ${literal}`;
  });
}
