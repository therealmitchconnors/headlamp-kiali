import { isRecord } from './object';

export const TEMPO_SPAN_RELATIONS = [
  { value: 'and', operator: '&&' },
  { value: 'child', operator: '>' },
  { value: 'parent', operator: '<' },
  { value: 'descendant', operator: '>>' },
  { value: 'ancestor', operator: '<<' },
  { value: 'sibling', operator: '~' },
] as const;

export const MAX_TEMPO_SPAN_GROUPS = 5;
export const MAX_TEMPO_RELATED_GROUPS = MAX_TEMPO_SPAN_GROUPS - 1;

export interface TempoRelatedSpan {
  relation: (typeof TEMPO_SPAN_RELATIONS)[number]['value'];
  service: string;
  operation?: string;
  errorsOnly?: boolean;
}

type TempoSpanExpression =
  | { kind: 'primary' }
  | { kind: 'group'; clause: string }
  | {
      kind: 'relation';
      relation: TempoRelatedSpan['relation'];
      left: TempoSpanExpression;
      right: TempoSpanExpression;
    };

function relatedSpanGroup(value: unknown): TempoRelatedSpan {
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
  if (!TEMPO_SPAN_RELATIONS.some(item => item.value === value.relation))
    throw new Error('Choose a supported Tempo span relationship');
  return value as unknown as TempoRelatedSpan;
}

function relatedSpanGroupClause(value: TempoRelatedSpan): string {
  const clauses = [`.service.name = ${JSON.stringify(value.service)}`];
  if (value.operation) clauses.push(`span:name = ${JSON.stringify(value.operation)}`);
  if (value.errorsOnly) clauses.push('span:status = error');
  return `{ ${clauses.join(' && ')} }`;
}

function relationOperator(relation: TempoRelatedSpan['relation']): string {
  return TEMPO_SPAN_RELATIONS.find(item => item.value === relation)!.operator;
}

export function tempoRelatedSpanClause(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const group = relatedSpanGroup(value);
  return `${relationOperator(group.relation)} ${relatedSpanGroupClause(group)}`;
}

export function tempoRelatedSpansetClause(primary: string, value: unknown): string {
  if (value === undefined) return primary;
  if (!Array.isArray(value) || value.length > MAX_TEMPO_RELATED_GROUPS)
    throw new Error(
      `Trace search supports at most ${MAX_TEMPO_SPAN_GROUPS} Tempo span groups, including the primary group`
    );
  if (!value.length) return primary;

  let expression: TempoSpanExpression = { kind: 'primary' };
  for (const candidate of value) {
    const group = relatedSpanGroup(candidate);
    expression = {
      kind: 'relation',
      relation: group.relation,
      left: expression,
      right: { kind: 'group', clause: relatedSpanGroupClause(group) },
    };
  }

  const serialize = (node: TempoSpanExpression): string => {
    if (node.kind === 'primary') return primary;
    if (node.kind === 'group') return node.clause;
    const left = serialize(node.left);
    const right = serialize(node.right);
    return `${node.left.kind === 'primary' ? left : `(${left})`} ${relationOperator(
      node.relation
    )} ${right}`;
  };
  return serialize(expression);
}
