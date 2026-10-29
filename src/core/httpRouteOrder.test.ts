import { allHttpRoutes, editableHttpRoutes } from './httpRouteBehavior';
import { planHttpRouteOrder } from './httpRouteOrder';

const first = {
  name: 'first',
  match: [{ headers: { 'x-test': { exact: 'yes' } } }],
  route: [{ destination: { host: 'reviews', subset: 'v1' }, weight: 100 }],
  mirror: { host: 'shadow' },
  mirrorPercentage: { value: 5 },
  timeout: '10s',
};
const second = { name: 'second', match: [{ uri: { exact: '/old' } }], redirect: { uri: '/new' } };
const fallback = { name: 'fallback', route: [{ destination: { host: 'reviews' } }] };
const spec = {
  hosts: ['reviews'],
  http: [first, second, fallback],
  tcp: [{ route: [{ destination: { host: 'tcp' } }] }],
  extension: { retained: true },
};

it('moves complete HTTP rules without modifying their fields, other protocols or evidence', () => {
  const before = JSON.stringify(spec);
  const plan = planHttpRouteOrder(spec, { from: 0, to: 1 });
  expect(plan.spec).toEqual({ ...spec, http: [second, first, fallback] });
  expect(plan.order.map(route => route.index)).toEqual([1, 0, 2]);
  expect(JSON.stringify(spec)).toBe(before);
  expect(allHttpRoutes(spec).map(route => route.name)).toEqual(['first', 'second', 'fallback']);
  expect(editableHttpRoutes(spec).map(route => route.name)).toEqual(['first', 'fallback']);
});

it('supports moving in either direction and correcting a misplaced catch-all', () => {
  expect(planHttpRouteOrder(spec, { from: 1, to: 0 }).spec).toEqual({
    ...spec,
    http: [second, first, fallback],
  });
  expect(
    planHttpRouteOrder({ ...spec, http: [fallback, first, second] }, { from: 0, to: 2 }).spec
  ).toEqual(spec);
});

it.each([
  undefined,
  null,
  [],
  [{}],
  [{ name: 'only-a-name' }],
  [{ ignoreUriCase: true }],
  [{ statPrefix: 'statistics-only' }],
  [
    {
      port: 0,
      sourceNamespace: '',
      gateways: [],
      sourceLabels: {},
      headers: {},
      queryParams: {},
      withoutHeaders: {},
    },
  ],
  [{ uri: null, scheme: null, method: null, authority: null }],
  [{ headers: { method: { exact: 'GET' } } }],
  [{ uri: { exact: '/limited' } }, {}],
])('blocks definitely unconditional matches %j before a later rule', match => {
  expect(() =>
    planHttpRouteOrder({ http: [{ ...fallback, match }, first, second] }, { from: 1, to: 2 })
  ).toThrow('must be last');
});

it('does not infer unconditional behavior from unresolved delegated matches or complex overlap', () => {
  const delegated = { name: 'delegate', delegate: { name: 'other-routes' } };
  expect(
    planHttpRouteOrder({ http: [first, delegated, fallback] }, { from: 1, to: 0 }).spec
  ).toEqual({ http: [delegated, first, fallback] });
  const conditional = { ...first, match: [{ uri: { prefix: '/' } }] };
  expect(
    planHttpRouteOrder({ http: [first, conditional, fallback] }, { from: 1, to: 0 }).spec
  ).toEqual({ http: [conditional, first, fallback] });
});

it.each([-1, 3, 0.5, NaN, Infinity])('rejects invalid source and target index %s', index => {
  expect(() => planHttpRouteOrder(spec, { from: index, to: 1 })).toThrow('valid new position');
  expect(() => planHttpRouteOrder(spec, { from: 0, to: index })).toThrow('valid new position');
});

it('rejects no-ops, identical-rule moves, too-short lists and malformed routes/matches', () => {
  expect(() => planHttpRouteOrder(spec, { from: 0, to: 0 })).toThrow('would not change');
  expect(() => planHttpRouteOrder({ http: [first, first] }, { from: 0, to: 1 })).toThrow(
    'would not change'
  );
  expect(() => planHttpRouteOrder({ http: [first] }, { from: 0, to: 1 })).toThrow('At least two');
  expect(() => planHttpRouteOrder({ http: [first, null] }, { from: 0, to: 1 })).toThrow(
    'Malformed'
  );
  for (const match of [{}, [null]]) {
    expect(() =>
      planHttpRouteOrder({ http: [first, { ...second, match }] }, { from: 0, to: 1 })
    ).toThrow();
  }
});

it('enforces exact route and match-alternative bounds', () => {
  const routes = Array.from({ length: 100 }, (_, index) => ({ ...first, name: `route-${index}` }));
  expect(planHttpRouteOrder({ http: routes }, { from: 0, to: 99 }).order).toHaveLength(100);
  expect(() => planHttpRouteOrder({ http: [...routes, first] }, { from: 0, to: 1 })).toThrow(
    '100 routes'
  );
  const matches = Array.from({ length: 100 }, () => ({ port: 9080 }));
  expect(
    planHttpRouteOrder({ http: [first, { ...second, match: matches }] }, { from: 0, to: 1 }).order
  ).toHaveLength(2);
  expect(() =>
    planHttpRouteOrder(
      { http: [first, { ...second, match: [...matches, { port: 9080 }] }] },
      { from: 0, to: 1 }
    )
  ).toThrow('100 match');
});
