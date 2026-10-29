import {
  HttpMirroringDraft,
  initialHttpMirroring,
  mirrorTarget,
  planHttpMirroring,
} from './httpMirroring';
import { editableHttpRoutes } from './httpRouteBehavior';

const route = {
  name: 'forward',
  match: [{ uri: { prefix: '/reviews' }, port: 9080 }],
  route: [
    { destination: { host: 'reviews', subset: 'v1' }, weight: 75 },
    { destination: { host: 'reviews', subset: 'v2' }, weight: 25 },
  ],
  timeout: '10s',
  retries: { attempts: 2 },
  headers: { request: { add: { 'x-header': 'retained' } } },
};
const spec = {
  hosts: ['reviews'],
  gateways: ['mesh'],
  http: [{ redirect: { uri: '/elsewhere' } }, route, { ...route, name: 'other' }],
  tcp: [{ route: [{ destination: { host: 'tcp-target' } }] }],
};
const draft: HttpMirroringDraft = {
  ...initialHttpMirroring(editableHttpRoutes(spec)[0]),
  mode: 'set',
  host: 'shadow.bookinfo.svc.cluster.local',
  subset: 'v3',
  port: '9080',
  percentage: '12.5',
};

it('plans a single-target mirror without changing forwarding, other routes or evidence', () => {
  const before = JSON.stringify(spec);
  const plan = planHttpMirroring(spec, draft);
  expect(plan.index).toBe(1);
  expect(plan.spec).toEqual({
    ...spec,
    http: [
      spec.http[0],
      {
        ...route,
        mirror: { host: draft.host, subset: 'v3', port: { number: 9080 } },
        mirrorPercentage: { value: 12.5 },
      },
      spec.http[2],
    ],
  });
  expect(JSON.stringify(spec)).toBe(before);
});

it.each([
  [{ mirror: { host: 'shadow' } }, '100'],
  [{ mirror: { host: 'shadow' }, mirrorPercentage: { value: 0 } }, '0'],
  [{ mirror: { host: 'shadow' }, mirrorPercent: 17 }, '17'],
  [{ mirror: { host: 'shadow' }, mirror_percent: 9 }, '9'],
  [{ mirrors: [{ destination: { host: 'shadow' }, percentage: { value: 0.25 } }] }, '0.25'],
  [{ mirrors: [{ destination: { host: 'shadow' } }] }, '100'],
])(
  'initializes all supported mirror representations without enabling editing',
  (fields, percentage) => {
    const value = initialHttpMirroring({ index: 4, value: { ...route, ...fields } });
    expect(value).toMatchObject({ routeIndex: 4, mode: 'keep', host: 'shadow', percentage });
  }
);

it('replaces competing lists and deprecated aliases, retaining unrelated route metadata', () => {
  const value = {
    ...route,
    mirror: { host: 'old', subset: 'old', port: { number: 80 }, extension: 'keep' },
    mirrorPercentage: { value: 99, extension: true },
    mirrorPercent: 9,
    mirror_percent: 10,
    mirrors: [{ destination: { host: 'a' } }, { destination: { host: 'b' } }],
  };
  const plan = planHttpMirroring(
    { http: [value] },
    { ...draft, routeIndex: 0, subset: '', port: '' }
  );
  expect(plan.spec).toEqual({
    http: [
      {
        ...route,
        mirror: { host: draft.host, extension: 'keep' },
        mirrorPercentage: { value: 12.5, extension: true },
      },
    ],
  });
});

it('removes all mirror forms without validating unused draft values', () => {
  const plan = planHttpMirroring(
    {
      http: [
        {
          ...route,
          mirror: {},
          mirrorPercentage: {},
          mirrorPercent: 1,
          mirror_percent: 2,
          mirrors: [],
        },
      ],
    },
    { ...draft, routeIndex: 0, mode: 'remove', host: '', port: 'invalid' }
  );
  expect(plan.spec).toEqual({ http: [route] });
});

it('rejects no-ops, including alternate JSON property order', () => {
  expect(() => planHttpMirroring(spec, { ...draft, mode: 'keep' })).toThrow('Choose');
  expect(() => planHttpMirroring(spec, { ...draft, mode: 'remove' })).toThrow('would not change');
  const value = {
    ...route,
    mirror: { subset: 'v3', port: { number: 9080 }, host: draft.host },
    mirrorPercentage: { value: 12.5 },
  };
  expect(() => planHttpMirroring({ http: [value] }, { ...draft, routeIndex: 0 })).toThrow(
    'would not change'
  );
});

it.each(['', ' ', '1\n', '0x10', '1e1', '-1', '100.1', 'NaN', 'Infinity', '1'.repeat(33)])(
  'rejects invalid mirror percentage %j',
  percentage => {
    expect(() => mirrorTarget({ ...draft, percentage })).toThrow('percentage');
  }
);
it.each(['0', '65536', '1.5', '0x10', '1e1', '1\n', ' 80', '-1', '000080'])(
  'rejects invalid mirror port %j',
  port => {
    expect(() => mirrorTarget({ ...draft, port })).toThrow('port');
  }
);
it.each(['', '*', '*.example.com', 'https://shadow', 'shadow/path', 'shadow\n', 'a'.repeat(64)])(
  'rejects invalid mirror host %j',
  host => {
    expect(() => mirrorTarget({ ...draft, host })).toThrow('host');
  }
);
it('keeps zero, fractional and full mirror percentages separate from forwarding weights', () => {
  for (const percentage of ['0', '0.001', '100']) {
    expect(mirrorTarget({ ...draft, percentage, subset: '', port: '' })).toEqual({
      mirror: { host: draft.host },
      mirrorPercentage: { value: Number(percentage) },
    });
  }
  expect(() => mirrorTarget({ ...draft, subset: 'bad.subset' })).toThrow('subset');
});
it('only edits a captured forwarding route within the bounded list', () => {
  expect(() => planHttpMirroring(spec, { ...draft, routeIndex: 0 })).toThrow('forwarding');
  expect(() =>
    planHttpMirroring({ http: Array.from({ length: 101 }, () => route) }, draft)
  ).toThrow('100 routes');
  expect(() => planHttpMirroring({ http: [null] }, draft)).toThrow('Malformed');
});

it('preserves unknown destination port metadata when setting the port number', () => {
  const value = { ...route, mirror: { host: 'old', port: { extension: 'keep', number: 80 } } };
  expect(planHttpMirroring({ http: [value] }, { ...draft, routeIndex: 0 }).spec).toMatchObject({
    http: [{ mirror: { host: draft.host, port: { extension: 'keep', number: 9080 } } }],
  });
});
