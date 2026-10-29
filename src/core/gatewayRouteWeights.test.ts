import { gatewayWeightedRules, planGatewayWeights } from './gatewayRouteWeights';

const rule = {
  name: 'weighted',
  matches: [{ path: { type: 'PathPrefix', value: '/reviews' } }],
  filters: [
    {
      type: 'RequestHeaderModifier',
      requestHeaderModifier: { set: [{ name: 'x-test', value: 'yes' }] },
    },
  ],
  timeouts: { request: '10s' },
  backendRefs: [
    {
      name: 'reviews',
      namespace: 'one',
      port: 9080,
      weight: 1,
      filters: [
        { type: 'ResponseHeaderModifier', responseHeaderModifier: { remove: ['x-hidden'] } },
      ],
    },
    { name: 'reviews', namespace: 'two', group: '', kind: 'Service', port: 9080 },
  ],
};
const spec = {
  hostnames: ['example.com'],
  parentRefs: [{ name: 'gateway', namespace: 'edge' }],
  rules: [{ filters: [{ type: 'RequestRedirect' }] }, rule],
  extension: { retained: true },
};
it('edits relative weights without normalizing to percentages or modifying references/filters', () => {
  const before = JSON.stringify(spec);
  const planned = planGatewayWeights(spec, { ruleIndex: 1, weights: ['2', '3'] });
  expect(planned.spec).toEqual({
    ...spec,
    rules: [
      spec.rules[0],
      {
        ...rule,
        backendRefs: [
          { ...rule.backendRefs[0], weight: 2 },
          { ...rule.backendRefs[1], weight: 3 },
        ],
      },
    ],
  });
  expect(planned.weights).toEqual([2, 3]);
  expect(planned.rule.backends.map(value => value.namespace)).toEqual(['one', 'two']);
  expect(JSON.stringify(spec)).toBe(before);
});
it('uses default1 and treats equivalent default weights as a no-op', () => {
  expect(gatewayWeightedRules(spec)[0].backends.map(value => value.weight)).toEqual([1, 1]);
  expect(() => planGatewayWeights(spec, { ruleIndex: 1, weights: ['1', '1'] })).toThrow(
    'would not change'
  );
  expect(
    gatewayWeightedRules({ rules: [{ backendRefs: [{ name: 'test', weight: null }] }] })[0]
      .backends[0].weight
  ).toBe(1);
});
it.each(['', ' ', '1\n', '1.5', '1e2', '0x10', '-1', '1000001', '00000000'])(
  'rejects invalid relative weight %j',
  weight => {
    expect(() => planGatewayWeights(spec, { ruleIndex: 1, weights: [weight, '1'] })).toThrow(
      'decimal integers'
    );
  }
);
it('supports explicit zero and the exact maximum while requiring at least one positive backend', () => {
  expect(planGatewayWeights(spec, { ruleIndex: 1, weights: ['0', '1000000'] }).weights).toEqual([
    0, 1000000,
  ]);
  expect(() => planGatewayWeights(spec, { ruleIndex: 1, weights: ['0', '0'] })).toThrow(
    'positive weight'
  );
  expect(() => planGatewayWeights(spec, { ruleIndex: 0, weights: ['1'] })).toThrow(
    'existing Gateway API rule'
  );
  expect(() => planGatewayWeights(spec, { ruleIndex: 1, weights: ['1'] })).toThrow('Every backend');
});
it('bounds malformed lists, rules and backends rather than silently dropping entries', () => {
  const backends = Array.from({ length: 16 }, (_, index) => ({ name: `backend-${index}` }));
  const rules = Array.from({ length: 16 }, () => ({ backendRefs: backends }));
  expect(gatewayWeightedRules({ rules })).toHaveLength(16);
  expect(() => gatewayWeightedRules({ rules: [...rules, rule] })).toThrow('16 rules');
  expect(() =>
    gatewayWeightedRules({ rules: [{ backendRefs: [...backends, { name: 'extra' }] }] })
  ).toThrow('16 backends');
  for (const bad of [
    null,
    { name: '' },
    { name: 'bad', weight: -1 },
    { name: 'bad', port: 65536 },
    { name: 'bad', namespace: 1 },
  ])
    expect(() => gatewayWeightedRules({ rules: [{ backendRefs: [bad] }] })).toThrow();
});
