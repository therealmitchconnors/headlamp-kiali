import { RE2JS } from 're2js';
import { isRecord } from './object';

export const TRACE_ATTRIBUTE_SCOPES = [
  'span',
  'resource',
  'unscoped',
  'event',
  'link',
  'instrumentation',
] as const;
export const TRACE_ATTRIBUTE_TYPES = ['string', 'integer', 'float', 'boolean', 'nil'] as const;
export const TRACE_ATTRIBUTE_OPERATORS = ['=', '!=', '>', '>=', '<', '<=', '=~', '!~'] as const;
export interface TempoAttributeFilter {
  scope: (typeof TRACE_ATTRIBUTE_SCOPES)[number];
  key: string;
  type: (typeof TRACE_ATTRIBUTE_TYPES)[number];
  operator: (typeof TRACE_ATTRIBUTE_OPERATORS)[number];
  value: string;
}
export function traceAttributeOperatorAllowed(
  type: TempoAttributeFilter['type'],
  operator: TempoAttributeFilter['operator']
): boolean {
  if (type === 'boolean' || type === 'nil') return operator === '=' || operator === '!=';
  return type === 'string' || (operator !== '=~' && operator !== '!~');
}
function integerLiteral(value: string): string {
  if (value.length > 20 || /^-?(?:0|[1-9][0-9]*)$/.exec(value)?.[0] !== value)
    throw new Error('Integer trace filters require a canonical signed 64-bit decimal');
  const parsed = BigInt(value);
  if (parsed < BigInt('-9223372036854775808') || parsed > BigInt('9223372036854775807'))
    throw new Error('Integer trace filter exceeds signed 64-bit bounds');
  // The lexer parses the positive token before unary minus, so this boundary needs arithmetic.
  return parsed === BigInt('-9223372036854775808') ? '(-9223372036854775807 - 1)' : value;
}
function floatLiteral(value: string): string {
  if (
    value.length > 64 ||
    /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.exec(value)?.[0] !== value ||
    !Number.isFinite(Number(value)) ||
    (Number(value) === 0 && /[1-9]/.test(value.split(/[eE]/)[0]))
  )
    throw new Error(
      'Float trace filters require a finite decimal or exponent without overflow or underflow'
    );
  return /[.eE]/.test(value) ? value : `${value}.0`;
}

export function traceStringLiteral(
  value: string,
  operator: TempoAttributeFilter['operator']
): string {
  if (operator === '=~' || operator === '!~') {
    if (value.length > 512) throw new Error('Trace regex filters are limited to 512 characters');
    try {
      RE2JS.compile(value);
    } catch (error) {
      throw new Error(
        `Invalid trace RE2 expression: ${
          error instanceof Error ? error.message : 'unsupported expression'
        }`
      );
    }
  }
  return JSON.stringify(value);
}

export function tempoAttributeIdentifier(key: unknown): string {
  if (
    typeof key !== 'string' ||
    !key.length ||
    key.length > 256 ||
    key.trim() !== key ||
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ud800-\udfff]/u.test(key)
  )
    throw new Error(
      'Tempo attribute names require 1 to 256 characters without controls, unpaired surrogates or surrounding whitespace'
    );
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.exec(key)?.[0] === key ? key : JSON.stringify(key);
}

export function tempoAttributeClauses(filters: readonly TempoAttributeFilter[] = []): string[] {
  if (!Array.isArray(filters) || filters.length > 10)
    throw new Error('Trace search supports at most 10 typed Tempo attribute filters');
  return filters.map(filter => {
    if (!isRecord(filter)) throw new Error('Invalid typed Tempo attribute filter');
    const scope = TRACE_ATTRIBUTE_SCOPES.find(scope => scope === filter.scope);
    const type = TRACE_ATTRIBUTE_TYPES.find(type => type === filter.type);
    const operator = TRACE_ATTRIBUTE_OPERATORS.find(operator => operator === filter.operator);
    if (!scope || !type || !operator || !traceAttributeOperatorAllowed(type, operator))
      throw new Error('Unsupported Tempo attribute scope, type or comparison operator');
    const identifier = tempoAttributeIdentifier(filter.key);
    if (typeof filter.value !== 'string' || filter.value.length > 1024)
      throw new Error('Typed trace filter values must be strings of at most 1024 characters');
    let literal: string;
    if (type === 'string') literal = traceStringLiteral(filter.value, operator);
    else if (type === 'integer') literal = integerLiteral(filter.value);
    else if (type === 'float') literal = floatLiteral(filter.value);
    else if (type === 'nil') {
      if (filter.value !== '') throw new Error('Missing/null trace filters do not take a value');
      literal = 'nil';
    } else {
      if (filter.value !== 'true' && filter.value !== 'false')
        throw new Error('Boolean trace filters require true or false');
      literal = filter.value;
    }
    return `${scope === 'unscoped' ? '' : scope}.${identifier} ${operator} ${literal}`;
  });
}
