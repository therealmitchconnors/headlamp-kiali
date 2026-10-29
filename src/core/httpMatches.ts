import { RE2JS } from 're2js';
import type { VirtualServiceSpec } from '../resources/schema-types';
import { isRecord } from './object';

export const HTTP_MATCH_FIELDS = ['headers', 'uri', 'scheme', 'method', 'authority'] as const;
export const HTTP_MATCH_OPERATORS = ['exact', 'prefix', 'regex', 'presence'] as const;
export interface HttpMatchCondition {
  field: (typeof HTTP_MATCH_FIELDS)[number];
  header: string;
  operator: (typeof HTTP_MATCH_OPERATORS)[number];
  value: string;
}
type HttpMatch = NonNullable<NonNullable<VirtualServiceSpec['http']>[number]['match']>[number];
type StringMatch = NonNullable<HttpMatch['uri']>;

export function httpMatchHeaderName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 256 ||
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.exec(value)?.[0] !== value ||
    ['uri', 'scheme', 'method', 'authority'].includes(value)
  )
    throw new Error(
      'Use a lowercase hyphen-separated header name, at most 256 characters; URI, scheme, method and authority need their own field'
    );
  return value;
}

export function buildHttpMatches(conditions: readonly HttpMatchCondition[]): HttpMatch[] {
  if (!Array.isArray(conditions) || conditions.length > 20)
    throw new Error('HTTP request matching supports at most 20 conditions');
  const headers: [string, StringMatch][] = [];
  const alternatives: HttpMatch[] = [];
  const names = new Set<string>();
  const seen = new Set<string>();
  for (const condition of conditions) {
    if (!isRecord(condition)) throw new Error('Unknown HTTP request-match field or operator');
    const field = HTTP_MATCH_FIELDS.find(field => field === condition.field);
    const operator = HTTP_MATCH_OPERATORS.find(operator => operator === condition.operator);
    if (!field || !operator) throw new Error('Unknown HTTP request-match field or operator');
    let header = '';
    if (field === 'headers') {
      header = httpMatchHeaderName(condition.header);
      if (names.has(header))
        throw new Error(
          'Each header can have only one condition; duplicates would overwrite each other'
        );
      names.add(header);
    } else if (operator === 'presence') {
      throw new Error('Presence matching is available only for headers');
    }
    let value: StringMatch = {};
    if (operator !== 'presence') {
      if (
        typeof condition.value !== 'string' ||
        !condition.value ||
        condition.value.length > 1024 ||
        condition.value.trim() !== condition.value ||
        /[\u0000-\u001f\u007f]/.test(condition.value)
      )
        throw new Error(
          'Match values must contain 1 to 1024 characters without control characters or surrounding whitespace'
        );
      if (operator === 'regex') {
        if (condition.value.length > 512)
          throw new Error('HTTP match regexes are limited to 512 characters');
        try {
          RE2JS.compile(condition.value);
        } catch (error) {
          throw new Error(
            `Invalid HTTP match RE2 expression: ${
              error instanceof Error ? error.message : 'unsupported expression'
            }`
          );
        }
        value = { regex: condition.value };
      } else if (operator === 'prefix') value = { prefix: condition.value };
      else value = { exact: condition.value };
    }
    const identity = JSON.stringify([field, header, value]);
    if (seen.has(identity)) throw new Error('Remove the duplicate HTTP match condition');
    seen.add(identity);
    if (field === 'headers') headers.push([header, value]);
    else alternatives.push({ [field]: value });
  }
  return [...(headers.length ? [{ headers: Object.fromEntries(headers) }] : []), ...alternatives];
}
