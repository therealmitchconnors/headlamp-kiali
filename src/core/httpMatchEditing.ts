import {
  buildHttpMatches,
  HTTP_MATCH_FIELDS,
  HttpMatchCondition,
  httpMatchHeaderName,
} from './httpMatches';
import {
  allHttpRoutes,
  EditableHttpRoute,
  hasHttpMatchConditions,
  httpMatchAlternatives,
} from './httpRouteBehavior';
import { editableObject, isRecord } from './object';

export interface HttpMatchEditDraft {
  routeIndex: number;
  matchIndex: number;
  mode: 'keep' | 'set' | 'remove';
  condition: HttpMatchCondition;
}
export function existingHttpCondition(
  match: Record<string, unknown> | undefined,
  field: HttpMatchCondition['field'] = 'uri'
): HttpMatchCondition {
  const headers = isRecord(match?.headers) ? match.headers : {};
  const header = field === 'headers' ? Object.keys(headers)[0] ?? '' : '';
  const stored = field === 'headers' ? headers[header] : match?.[field];
  const value = isRecord(stored) ? stored : {};
  const operator = ['exact', 'prefix', 'regex'].find(key => typeof value[key] === 'string');
  return {
    field,
    header,
    operator:
      operator === 'prefix' || operator === 'regex'
        ? operator
        : field === 'headers' && isRecord(stored) && !Object.keys(stored).length
        ? 'presence'
        : 'exact',
    value: operator ? String(value[operator]) : '',
  };
}
export function initialHttpMatchEdit(route?: EditableHttpRoute): HttpMatchEditDraft {
  const value = route?.value.match;
  const first = Array.isArray(value) && isRecord(value[0]) ? value[0] : undefined;
  const field = HTTP_MATCH_FIELDS.find(field => first?.[field] !== undefined) ?? 'uri';
  return {
    routeIndex: route?.index ?? -1,
    matchIndex: 0,
    mode: 'keep',
    condition: existingHttpCondition(first, field),
  };
}

export function planHttpMatchEdit(
  spec: unknown,
  draft: HttpMatchEditDraft
): { spec: Record<string, unknown> } {
  if (draft.mode !== 'set' && draft.mode !== 'remove')
    throw new Error('Choose to set or remove an HTTP match condition');
  const selected = allHttpRoutes(spec).find(route => route.index === draft.routeIndex);
  if (!isRecord(spec) || !Array.isArray(spec.http) || !selected)
    throw new Error('Choose an existing HTTP route');
  const matches = httpMatchAlternatives(selected.value.match);
  if (!Number.isInteger(draft.matchIndex) || draft.matchIndex < 0 || !matches[draft.matchIndex])
    throw new Error(
      'Choose an existing match alternative; use the specification editor to add alternatives'
    );
  const field = HTTP_MATCH_FIELDS.find(field => field === draft.condition.field);
  if (!field) throw new Error('Unknown HTTP request-match field');
  const match = { ...matches[draft.matchIndex] };
  if (field === 'headers') {
    const header = httpMatchHeaderName(draft.condition.header);
    const headers = editableObject(match.headers, 'header conditions');
    if (draft.mode === 'remove') {
      if (!Object.prototype.hasOwnProperty.call(headers, header))
        throw new Error('The selected HTTP condition would not change');
      delete headers[header];
    } else {
      const replacement = buildHttpMatches([draft.condition])[0].headers;
      if (!replacement) throw new Error('A header condition is required');
      Object.assign(headers, replacement);
    }
    if (Object.keys(headers).length) match.headers = headers;
    else delete match.headers;
  } else if (draft.mode === 'remove') delete match[field];
  else {
    const replacement = buildHttpMatches([draft.condition])[0];
    match[field] = replacement[field];
  }
  if (!hasHttpMatchConditions(match))
    throw new Error(
      'Removing the last condition would create an unconditional alternative; use the specification editor for that explicit change'
    );
  if (JSON.stringify(match) === JSON.stringify(matches[draft.matchIndex]))
    throw new Error('The selected HTTP condition would not change');
  return {
    spec: {
      ...spec,
      http: spec.http.map((value, index) =>
        index === selected.index
          ? {
              ...selected.value,
              match: matches.map((value, index) => (index === draft.matchIndex ? match : value)),
            }
          : value
      ),
    },
  };
}
