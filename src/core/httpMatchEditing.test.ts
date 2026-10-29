import {
  existingHttpCondition,
  HttpMatchEditDraft,
  initialHttpMatchEdit,
  planHttpMatchEdit,
} from './httpMatchEditing';
import { allHttpRoutes } from './httpRouteBehavior';

const match = {
  name: 'scoped',
  port: 9080,
  sourceNamespace: 'clients',
  sourceLabels: { app: 'client' },
  gateways: ['mesh'],
  ignoreUriCase: true,
  uri: { prefix: '/reviews' },
  headers: { 'x-user': { exact: 'old' }, 'x-present': {} },
  queryParams: { debug: { exact: 'true' } },
  withoutHeaders: { 'x-denied': {} },
  extension: { retained: true },
};
const route = {
  name: 'first',
  match: [match, { uri: { exact: '/second' }, port: 9080 }],
  route: [{ destination: { host: 'reviews', subset: 'v1' }, weight: 100 }],
  mirror: { host: 'shadow' },
  timeout: '10s',
};
const spec = {
  hosts: ['reviews'],
  http: [route, { redirect: { uri: '/' } }],
  tcp: [{ route: [{ destination: { host: 'tcp' } }] }],
};
const draft: HttpMatchEditDraft = {
  ...initialHttpMatchEdit(allHttpRoutes(spec)[0]),
  mode: 'set',
  condition: { field: 'uri', header: '', operator: 'regex', value: '/reviews/.*' },
};

it('updates one condition while preserving every other restriction and route field', () => {
  const before = JSON.stringify(spec);
  expect(planHttpMatchEdit(spec, draft).spec).toEqual({
    ...spec,
    http: [
      { ...route, match: [{ ...match, uri: { regex: '/reviews/.*' } }, route.match[1]] },
      spec.http[1],
    ],
  });
  expect(JSON.stringify(spec)).toBe(before);
});
it('adds or changes one header without renaming or losing other headers', () => {
  for (const header of ['x-user', 'x-new']) {
    expect(
      planHttpMatchEdit(spec, {
        ...draft,
        condition: { field: 'headers', header, operator: 'presence', value: '' },
      }).spec
    ).toEqual({
      ...spec,
      http: [
        {
          ...route,
          match: [{ ...match, headers: { ...match.headers, [header]: {} } }, route.match[1]],
        },
        spec.http[1],
      ],
    });
  }
});
it('removes only the selected field or header, ignoring unused draft syntax', () => {
  const { uri, ...rest } = match;
  expect(uri).toBeDefined();
  expect(
    planHttpMatchEdit(spec, {
      ...draft,
      mode: 'remove',
      condition: { ...draft.condition, value: '(' },
    }).spec
  ).toEqual({
    ...spec,
    http: [{ ...route, match: [rest, route.match[1]] }, spec.http[1]],
  });
  expect(
    planHttpMatchEdit(spec, {
      ...draft,
      mode: 'remove',
      condition: { field: 'headers', header: 'x-user', operator: 'regex', value: '(' },
    }).spec
  ).toEqual({
    ...spec,
    http: [
      { ...route, match: [{ ...match, headers: { 'x-present': {} } }, route.match[1]] },
      spec.http[1],
    ],
  });
});
it('removes an emptied header map but never silently creates an unconditional alternative', () => {
  const condition = {
    field: 'headers' as const,
    header: 'x-user',
    operator: 'exact' as const,
    value: '',
  };
  const scoped = { http: [{ ...route, match: [{ port: 9080, headers: { 'x-user': {} } }] }] };
  expect(planHttpMatchEdit(scoped, { ...draft, mode: 'remove', condition }).spec).toHaveProperty(
    'http.0.match',
    [{ port: 9080 }]
  );
  expect(() =>
    planHttpMatchEdit(
      {
        http: [
          {
            ...route,
            match: [{ name: 'metadata-only', ignoreUriCase: true, headers: { 'x-user': {} } }],
          },
        ],
      },
      {
        ...draft,
        mode: 'remove',
        condition,
      }
    )
  ).toThrow('unconditional alternative');
});
it('initializes original conditions without enabling edits or inferring missing values', () => {
  const initial = initialHttpMatchEdit(allHttpRoutes(spec)[0]);
  expect(initial).toMatchObject({
    mode: 'keep',
    condition: { field: 'headers', header: 'x-user', operator: 'exact', value: 'old' },
  });
  expect(existingHttpCondition(match, 'uri')).toMatchObject({
    field: 'uri',
    operator: 'prefix',
    value: '/reviews',
  });
  expect(existingHttpCondition({ headers: { 'x-test': {} } }, 'headers')).toMatchObject({
    header: 'x-test',
    operator: 'presence',
  });
  expect(existingHttpCondition(undefined, 'method')).toMatchObject({
    operator: 'exact',
    value: '',
  });
});
it('does not mistake logging metadata or protobuf-empty fields for remaining restrictions', () => {
  for (const extra of [
    { statPrefix: 'statistics-only' },
    {
      port: 0,
      sourceNamespace: '',
      gateways: [],
      sourceLabels: {},
      queryParams: {},
      withoutHeaders: {},
    },
    { headers: { method: { exact: 'GET' } } },
  ]) {
    expect(() =>
      planHttpMatchEdit(
        {
          http: [{ ...route, match: [{ ...extra, uri: { exact: '/only-condition' } }] }],
        },
        { ...draft, mode: 'remove' }
      )
    ).toThrow('unconditional alternative');
  }
});
it('rejects no-ops, absent targets, invalid syntax and unknown fields', () => {
  expect(() => planHttpMatchEdit(spec, { ...draft, mode: 'keep' })).toThrow(
    'Choose to set or remove'
  );
  expect(() =>
    planHttpMatchEdit(spec, { ...draft, condition: existingHttpCondition(match, 'uri') })
  ).toThrow('would not change');
  expect(() =>
    planHttpMatchEdit(spec, {
      ...draft,
      mode: 'remove',
      condition: { ...draft.condition, field: 'method' },
    })
  ).toThrow('would not change');
  expect(() =>
    planHttpMatchEdit(spec, {
      ...draft,
      mode: 'remove',
      condition: { field: 'headers', header: 'x-missing', operator: 'presence', value: '' },
    })
  ).toThrow('would not change');
  expect(() =>
    planHttpMatchEdit(spec, { ...draft, condition: { ...draft.condition, value: '(?=x)' } })
  ).toThrow('RE2');
  const invalid = structuredClone(draft);
  Object.assign(invalid.condition, { field: 'queryParams' });
  expect(() => planHttpMatchEdit(spec, invalid)).toThrow('Unknown');
});
it.each([-1, 2, 0.5, NaN])('rejects invalid alternative index %s', matchIndex => {
  expect(() => planHttpMatchEdit(spec, { ...draft, matchIndex })).toThrow(
    'existing match alternative'
  );
});
it('bounds malformed lists and refuses to fabricate an alternative on a catch-all route', () => {
  for (const value of [undefined, null, [], {}, [null], Array.from({ length: 101 }, () => match)]) {
    expect(() => planHttpMatchEdit({ http: [{ ...route, match: value }] }, draft)).toThrow();
  }
  expect(() => planHttpMatchEdit(spec, { ...draft, routeIndex: 99 })).toThrow(
    'existing HTTP route'
  );
});
