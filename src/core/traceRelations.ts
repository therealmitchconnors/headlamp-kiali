import { isRecord } from './object';

export const TEMPO_SPAN_RELATIONS = [
  { value: 'and', operator: '&&' },
  { value: 'child', operator: '>' },
  { value: 'parent', operator: '<' },
  { value: 'descendant', operator: '>>' },
  { value: 'ancestor', operator: '<<' },
  { value: 'sibling', operator: '~' },
] as const;

export interface TempoRelatedSpan {
  relation: (typeof TEMPO_SPAN_RELATIONS)[number]['value'];
  service: string;
  operation?: string;
  errorsOnly?: boolean;
}

export function tempoRelatedSpanClause(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      key => !['relation', 'service', 'operation', 'errorsOnly'].includes(key)
    ) ||
    typeof value.service !== 'string' ||
    !value.service.trim() ||
    value.service.length > 256 ||
    (value.operation !== undefined &&
      (typeof value.operation !== 'string' || value.operation.length > 256)) ||
    (value.errorsOnly !== undefined && typeof value.errorsOnly !== 'boolean')
  )
    throw new Error(
      'Related span filters require a service and optional operation of at most 256 characters, with a boolean error filter'
    );
  const relation = TEMPO_SPAN_RELATIONS.find(item => item.value === value.relation);
  if (!relation) throw new Error('Choose a supported Tempo span relationship');
  const clauses = [`.service.name = ${JSON.stringify(value.service)}`];
  if (value.operation) clauses.push(`span:name = ${JSON.stringify(value.operation)}`);
  if (value.errorsOnly) clauses.push('span:status = error');
  return `${relation.operator} { ${clauses.join(' && ')} }`;
}
