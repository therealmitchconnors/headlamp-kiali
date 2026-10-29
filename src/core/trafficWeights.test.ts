import { initialRouteWeights, planTrafficWeights, weightedRoutes } from './trafficWeights';

const spec = {
  hosts: ['reviews'],
  gateways: ['mesh'],
  http: [
    {
      name: 'canary',
      match: [{ uri: { prefix: '/reviews' } }],
      timeout: '5s',
      mirror: { host: 'shadow' },
      headers: { request: { add: { 'x-example': 'preserve' } } },
      route: [
        {
          destination: { host: 'reviews', subset: 'v1', port: { number: 9080 } },
          weight: 50,
          headers: { response: { remove: ['x-old'] } },
        },
        { destination: { host: 'reviews', subset: 'v2' }, weight: 50 },
      ],
    },
    { redirect: { uri: '/new' } },
  ],
  tcp: [{ match: [{ port: 9000 }], route: [{ destination: { host: 'tcp-service' } }] }],
  tls: [
    {
      match: [{ port: 443, sniHosts: ['example.test'] }],
      route: [{ destination: { host: 'secure-service' } }],
    },
  ],
};

it('preserves every field except weights on the explicitly selected route', () => {
  const before = JSON.stringify(spec);
  const plan = planTrafficWeights(spec, 'http:0', [90, 10]);
  expect(plan.weights).toEqual([90, 10]);
  expect(plan.spec).toEqual({
    ...spec,
    http: [
      {
        ...spec.http[0],
        route: [
          { ...spec.http[0].route![0], weight: 90 },
          { ...spec.http[0].route![1], weight: 10 },
        ],
      },
      spec.http[1],
    ],
  });
  expect(JSON.stringify(spec)).toBe(before);
  expect(plan.route).toMatchObject({ protocol: 'http', index: 0, name: 'canary' });
});
it('excludes redirect-only rules and handles all three protocol selections', () => {
  const routes = weightedRoutes(spec);
  expect(routes.map(route => route.key)).toEqual(['http:0', 'tcp:0', 'tls:0']);
  expect(initialRouteWeights(routes[0])).toEqual([50, 50]);
  expect(initialRouteWeights(routes[1])).toEqual([100]);
  expect(planTrafficWeights(spec, 'tcp:0', [100]).spec.http).toBe(spec.http);
  expect(planTrafficWeights(spec, 'tls:0', [100]).spec.tcp).toBe(spec.tcp);
});
it.each(
  [[], [100], [50, 40], [101, -1], [33.3, 66.7], [NaN, 100], [Infinity, 0], [100, 0, 0]].map(
    weights => ({ weights })
  )
)('rejects invalid counts, totals, ranges and non-integer weights %j', ({ weights }) => {
  expect(() => planTrafficWeights(spec, 'http:0', weights)).toThrow();
});
it('rejects unknown selection and malformed source objects instead of inventing destinations', () => {
  expect(() => planTrafficWeights(spec, 'http:999', [100])).toThrow('Select');
  for (const value of [null, [], { http: {} }, { http: [null] }, { http: [{ route: [{}] }] }])
    expect(() => weightedRoutes(value)).toThrow();
  expect(weightedRoutes({ http: [{ directResponse: { status: 503 } }] })).toEqual([]);
});
it('caps the interactive form without silently omitting destinations or rules', () => {
  const route = { route: [{ destination: { host: 'reviews' }, weight: 100 }] };
  expect(
    weightedRoutes({ http: [{ route: Array.from({ length: 20 }, () => route.route[0]) }] })[0]
      .destinations
  ).toHaveLength(20);
  expect(weightedRoutes({ http: Array.from({ length: 100 }, () => route) })).toHaveLength(100);
  expect(() =>
    weightedRoutes({ http: [{ route: Array.from({ length: 21 }, () => route.route[0]) }] })
  ).toThrow('20 destinations');
  expect(() => weightedRoutes({ http: Array.from({ length: 101 }, () => route) })).toThrow(
    '100 routes'
  );
});
it('captures weights independently of a caller-owned mutable array', () => {
  const weights = [100, 0];
  const plan = planTrafficWeights(spec, 'http:0', weights);
  weights[0] = 0;
  expect(plan.weights).toEqual([100, 0]);
});
