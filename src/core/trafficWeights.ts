import { isRecord } from './object';

export interface WeightedRoute {
  key: string;
  protocol: 'http' | 'tcp' | 'tls';
  index: number;
  name?: string;
  destinations: { host: string; subset?: string; weight?: number }[];
}
export interface TrafficWeightPlan {
  spec: Record<string, unknown>;
  route: WeightedRoute;
  weights: number[];
}

export function weightedRoutes(spec: unknown): WeightedRoute[] {
  if (!isRecord(spec)) throw new Error('The VirtualService specification is unavailable');
  const choices: WeightedRoute[] = [];
  for (const protocol of ['http', 'tcp', 'tls'] as const) {
    const rules = spec[protocol];
    if (rules === undefined || rules === null) continue;
    if (!Array.isArray(rules)) throw new Error(`Malformed ${protocol} route list`);
    rules.forEach((rule: unknown, index) => {
      if (!isRecord(rule)) throw new Error(`Malformed ${protocol} route at index ${index}`);
      if (rule.route === undefined || rule.route === null) return;
      if (!Array.isArray(rule.route)) throw new Error('Malformed route destinations');
      if (!rule.route.length) return;
      if (rule.route.length > 20)
        throw new Error(
          'The weight editor supports at most 20 destinations per route; use the specification editor'
        );
      const destinations = rule.route.map((value: unknown) => {
        if (
          !isRecord(value) ||
          !isRecord(value.destination) ||
          typeof value.destination.host !== 'string' ||
          !value.destination.host ||
          (value.destination.subset !== undefined &&
            typeof value.destination.subset !== 'string') ||
          (value.weight !== undefined &&
            (typeof value.weight !== 'number' || !Number.isFinite(value.weight)))
        )
          throw new Error('A route destination has an invalid host, subset or weight');
        return {
          host: value.destination.host,
          ...(typeof value.destination.subset === 'string'
            ? { subset: value.destination.subset }
            : {}),
          ...(typeof value.weight === 'number' ? { weight: value.weight } : {}),
        };
      });
      choices.push({
        key: `${protocol}:${index}`,
        protocol,
        index,
        destinations,
        ...(typeof rule.name === 'string' ? { name: rule.name } : {}),
      });
      if (choices.length > 100)
        throw new Error(
          'The weight editor supports at most 100 routes; use the specification editor'
        );
    });
  }
  return choices;
}

export function initialRouteWeights(route: WeightedRoute): number[] {
  return route.destinations.map(destination =>
    route.destinations.length === 1 ? 100 : destination.weight ?? 0
  );
}

export function planTrafficWeights(
  spec: unknown,
  routeKey: string,
  weights: readonly number[]
): TrafficWeightPlan {
  const route = weightedRoutes(spec).find(route => route.key === routeKey);
  if (!isRecord(spec) || !route) throw new Error('Select an existing route with destinations');
  if (
    weights.length !== route.destinations.length ||
    weights.some(weight => !Number.isInteger(weight) || weight < 0 || weight > 100)
  )
    throw new Error('Every destination needs a whole-number weight between 0 and 100');
  if (weights.reduce((sum, weight) => sum + weight, 0) !== 100)
    throw new Error('Destination weights must sum to 100');
  const rules = spec[route.protocol];
  if (!Array.isArray(rules)) throw new Error('The selected route list is unavailable');
  return {
    route,
    weights: [...weights],
    spec: {
      ...spec,
      [route.protocol]: rules.map((rule: unknown, index) => {
        if (index !== route.index) return rule;
        if (!isRecord(rule) || !Array.isArray(rule.route))
          throw new Error('The selected route is malformed');
        return {
          ...rule,
          route: rule.route.map((destination: unknown, index) => {
            if (!isRecord(destination)) throw new Error('The selected destination is malformed');
            return { ...destination, weight: weights[index] };
          }),
        };
      }),
    },
  };
}
