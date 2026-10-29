import {
  editableHttpRoutes,
  initialHttpBehavior,
  planHttpBehavior,
  routeDuration,
} from './httpRouteBehavior';

const original = {
  hosts: ['reviews'],
  custom: { keep: false },
  http: [
    {
      name: 'first',
      match: [{ headers: { user: { exact: 'test' } } }],
      route: [{ destination: { host: 'reviews', subset: 'v1' }, weight: 100 }],
      timeout: '5s',
      retries: {
        attempts: 2,
        perTryTimeout: '1s',
        retryOn: 'connect-failure',
        retryRemoteLocalities: true,
        extra: { preserve: 0 },
      },
      mirror: { host: 'shadow' },
      headers: { request: { add: { 'x-test': 'keep' } } },
    },
    { name: 'second', route: [{ destination: { host: 'other' }, weight: 100 }], timeout: '20s' },
    { name: 'redirect', redirect: { uri: '/new' } },
  ],
  tcp: [{ route: [{ destination: { host: 'raw-tcp' } }] }],
};
const draft = () => initialHttpBehavior(editableHttpRoutes(original)[0]);
it('changes only the selected requested timeout/retry fields while preserving unknown nested settings', () => {
  const before = JSON.stringify(original);
  const plan = planHttpBehavior(original, {
    ...draft(),
    timeoutMode: 'set',
    timeout: '10s',
    retryMode: 'set',
    attempts: '3',
    perTryTimeout: '2s',
    retryOn: 'gateway-error,connect-failure',
  });
  expect(plan.spec).toEqual({
    ...original,
    http: [
      {
        ...original.http[0],
        timeout: '10s',
        retries: {
          ...original.http[0].retries,
          attempts: 3,
          perTryTimeout: '2s',
          retryOn: 'gateway-error,connect-failure',
        },
      },
      ...original.http.slice(1),
    ],
  });
  expect(JSON.stringify(original)).toBe(before);
  expect(editableHttpRoutes(original).map(route => route.index)).toEqual([0, 1]);
});
it('distinguishes keeping, removing, disabling and inheriting fields', () => {
  expect(() => planHttpBehavior(original, draft())).toThrow('at least one');
  const changed = planHttpBehavior(original, {
    ...draft(),
    timeoutMode: 'set',
    timeout: '0s',
    retryMode: 'remove',
  });
  expect(changed.spec.http).toEqual([
    expect.objectContaining({ timeout: '0s' }),
    original.http[1],
    original.http[2],
  ]);
  expect((changed.spec.http as object[])[0]).not.toHaveProperty('retries');
  const removed = planHttpBehavior(original, { ...draft(), timeoutMode: 'remove' });
  expect((removed.spec.http as object[])[0]).not.toHaveProperty('timeout');
});
it('requires explicit removal of timing controls before introducing delay/abort faults', () => {
  const next = {
    ...draft(),
    delayMode: 'set' as const,
    delay: '250ms',
    delayPercent: '0',
    abortMode: 'set' as const,
    abortStatus: '503',
    abortPercent: '12.5',
  };
  expect(() => planHttpBehavior(original, next)).toThrow('cannot be combined');
  const plan = planHttpBehavior(original, { ...next, timeoutMode: 'remove', retryMode: 'remove' });
  expect((plan.spec.http as Record<string, unknown>[])[0].fault).toEqual({
    delay: { fixedDelay: '250ms', percentage: { value: 0 } },
    abort: { httpStatus: 503, percentage: { value: 12.5 } },
  });
  expect((plan.spec.http as Record<string, unknown>[])[0]).not.toHaveProperty('timeout');
});
it('replaces known alternative fault types only when explicitly selected and retains other fields', () => {
  const spec = {
    http: [
      {
        route: original.http[0].route,
        fault: {
          custom: 'keep',
          delay: { exponentialDelay: '5s', percent: 5, custom: 'keep' },
          abort: {
            grpcStatus: 'UNAVAILABLE',
            http2Error: 'REFUSED_STREAM',
            percent: 9,
            custom: true,
          },
        },
      },
    ],
  };
  const value = initialHttpBehavior(editableHttpRoutes(spec)[0]);
  const plan = planHttpBehavior(spec, {
    ...value,
    delayMode: 'set',
    delay: '1s',
    delayPercent: '10',
    abortMode: 'set',
    abortStatus: '500',
    abortPercent: '20',
  });
  expect((plan.spec.http as Record<string, unknown>[])[0].fault).toEqual({
    custom: 'keep',
    delay: { fixedDelay: '1s', percentage: { value: 10 }, custom: 'keep' },
    abort: { httpStatus: 500, percentage: { value: 20 }, custom: true },
  });
});
it.each(['', '0s', '-1s', '0.5ms', '25h', '1e3s', '1s extra', '1.2.3s', 'Infinitys'])(
  'rejects unsupported bounded durations %s',
  value => expect(() => routeDuration(value)).toThrow()
);
it('supports explicit zero route timeout, fractional valid durations and exact bounds', () => {
  expect(routeDuration('0s', true)).toBe(0);
  expect(routeDuration('0.001s')).toBe(1);
  expect(routeDuration('24h')).toBe(86400000);
  expect(routeDuration('1.5m')).toBe(90000);
});
it.each([
  { retryMode: 'set', attempts: '11' },
  { retryMode: 'set', attempts: '1.5' },
  { retryMode: 'set', attempts: '' },
  { retryMode: 'set', retryOn: 'gateway-error, bad' },
  { delayMode: 'set', delayPercent: '101', timeoutMode: 'remove', retryMode: 'remove' },
  { abortMode: 'set', abortStatus: '600', timeoutMode: 'remove', retryMode: 'remove' },
  { abortMode: 'set', abortStatus: '503.5', timeoutMode: 'remove', retryMode: 'remove' },
])('rejects invalid HTTP controls %#', change => {
  expect(() =>
    planHttpBehavior(original, { ...draft(), ...change } as ReturnType<typeof draft>)
  ).toThrow();
});
it('blocks missing routes, no-op removals and oversize route collections', () => {
  expect(() =>
    planHttpBehavior(original, { ...draft(), routeIndex: 2, timeoutMode: 'remove' })
  ).toThrow('forwarding');
  expect(() =>
    planHttpBehavior(original, { ...draft(), routeIndex: 1, abortMode: 'remove' })
  ).toThrow('would not change');
  expect(() =>
    editableHttpRoutes({ http: Array.from({ length: 101 }, () => original.http[0]) })
  ).toThrow('100 routes');
});
