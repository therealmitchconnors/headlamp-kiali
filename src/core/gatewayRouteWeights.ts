import { isRecord } from './object';

export interface GatewayWeightedRule {
  index: number;
  name?: string;
  backends: {
    name: string;
    namespace?: string;
    group?: string;
    kind?: string;
    port?: number;
    weight: number;
  }[];
}
export interface GatewayWeightsDraft {
  ruleIndex: number;
  weights: string[];
}
export function gatewayWeightedRules(spec: unknown): GatewayWeightedRule[] {
  if (!isRecord(spec) || !Array.isArray(spec.rules))
    throw new Error('No Gateway API route rules are available');
  if (spec.rules.length > 16)
    throw new Error(
      'Gateway weight editing supports at most 16 rules; use the specification editor'
    );
  return spec.rules.flatMap((rule, index) => {
    if (!isRecord(rule)) throw new Error('Malformed Gateway API rule');
    if (rule.backendRefs === undefined || rule.backendRefs === null) return [];
    if (!Array.isArray(rule.backendRefs) || rule.backendRefs.length > 16)
      throw new Error(
        'Gateway weight editing supports valid lists of at most 16 backends per rule'
      );
    if (!rule.backendRefs.length) return [];
    const backends = rule.backendRefs.map(backend => {
      if (
        !isRecord(backend) ||
        typeof backend.name !== 'string' ||
        !backend.name ||
        backend.name.length > 253 ||
        ['namespace', 'group', 'kind'].some(
          key => backend[key] !== undefined && typeof backend[key] !== 'string'
        ) ||
        (backend.port !== undefined &&
          (typeof backend.port !== 'number' ||
            !Number.isInteger(backend.port) ||
            backend.port < 1 ||
            backend.port > 65535))
      )
        throw new Error('Malformed Gateway API backend reference');
      const weight = backend.weight ?? 1;
      if (typeof weight !== 'number' || !Number.isInteger(weight) || weight < 0 || weight > 1000000)
        throw new Error('Stored Gateway backend weights must be integers from 0 to 1000000');
      return {
        name: backend.name,
        weight,
        ...(typeof backend.namespace === 'string' ? { namespace: backend.namespace } : {}),
        ...(typeof backend.group === 'string' ? { group: backend.group } : {}),
        ...(typeof backend.kind === 'string' ? { kind: backend.kind } : {}),
        ...(typeof backend.port === 'number' ? { port: backend.port } : {}),
      };
    });
    return [{ index, backends, ...(typeof rule.name === 'string' ? { name: rule.name } : {}) }];
  });
}
export function planGatewayWeights(
  spec: unknown,
  draft: GatewayWeightsDraft
): {
  spec: Record<string, unknown>;
  rule: GatewayWeightedRule;
  weights: number[];
} {
  const rule = gatewayWeightedRules(spec).find(rule => rule.index === draft.ruleIndex);
  if (!isRecord(spec) || !Array.isArray(spec.rules) || !rule)
    throw new Error('Choose an existing Gateway API rule with backend references');
  if (!Array.isArray(draft.weights) || draft.weights.length !== rule.backends.length)
    throw new Error('Every backend requires an explicit relative weight');
  const weights = draft.weights.map(value => {
    if (
      typeof value !== 'string' ||
      value.length > 7 ||
      /^[0-9]+$/.exec(value)?.[0] !== value ||
      Number(value) > 1000000
    )
      throw new Error('Gateway backend weights must be decimal integers from 0 to 1000000');
    return Number(value);
  });
  if (!weights.some(weight => weight > 0))
    throw new Error(
      'At least one backend must retain a positive weight in this editor; use the specification editor for a deliberate all-zero rule'
    );
  if (weights.every((weight, index) => weight === rule.backends[index].weight))
    throw new Error('The effective Gateway backend weights would not change');
  return {
    rule,
    weights,
    spec: {
      ...spec,
      rules: spec.rules.map((value, index) => {
        if (index !== rule.index) return value;
        if (!isRecord(value) || !Array.isArray(value.backendRefs))
          throw new Error('The selected Gateway rule is malformed');
        return {
          ...value,
          backendRefs: value.backendRefs.map((backend: unknown, index) => {
            if (!isRecord(backend)) throw new Error('The selected Gateway backend is malformed');
            return { ...backend, weight: weights[index] };
          }),
        };
      }),
    },
  };
}
