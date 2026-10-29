import {
  allHttpRoutes,
  EditableHttpRoute,
  hasHttpMatchConditions,
  httpMatchAlternatives,
} from './httpRouteBehavior';
import { isRecord } from './object';

export interface HttpRouteOrderDraft {
  from: number;
  to: number;
}

function unconditional(route: Record<string, unknown>): boolean {
  if (route.delegate !== undefined && route.delegate !== null) return false;
  const matches = httpMatchAlternatives(route.match);
  return !matches.length || matches.some(match => !hasHttpMatchConditions(match));
}

export function planHttpRouteOrder(
  spec: unknown,
  draft: HttpRouteOrderDraft
): { spec: Record<string, unknown>; order: EditableHttpRoute[] } {
  const routes = allHttpRoutes(spec);
  if (!isRecord(spec) || routes.length < 2)
    throw new Error('At least two HTTP routes are required for ordering');
  if (
    [draft.from, draft.to].some(
      index => !Number.isInteger(index) || index < 0 || index >= routes.length
    )
  )
    throw new Error('Choose an existing route and a valid new position');
  if (draft.from === draft.to) throw new Error('The HTTP route order would not change');
  const order = [...routes];
  const [moved] = order.splice(draft.from, 1);
  order.splice(draft.to, 0, moved);
  order.forEach((route, index) => {
    if (unconditional(route.value) && index < order.length - 1)
      throw new Error(
        'A route without match conditions must be last; later routes would be unreachable'
      );
  });
  const http = order.map(route => route.value);
  if (JSON.stringify(http) === JSON.stringify(spec.http))
    throw new Error('The HTTP route order would not change');
  return { spec: { ...spec, http }, order };
}
