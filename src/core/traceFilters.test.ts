import {
  tempoAttributeClauses,
  TempoAttributeFilter,
  tempoAttributeIdentifier,
  TRACE_ATTRIBUTE_OPERATORS,
  TRACE_ATTRIBUTE_SCOPES,
  TRACE_ATTRIBUTE_TYPES,
  traceAttributeOperatorAllowed,
} from './traceFilters';
import { traceSearchPath } from './tracing';

const filter: TempoAttributeFilter = {
  scope: 'span',
  key: 'http.status_code',
  type: 'integer',
  operator: '>=',
  value: '500',
};
const query = { service: 'reviews', start: 1700000000, end: 1700000900, limit: 20 };

it('builds scoped typed clauses without converting literals through JavaScript numbers', () => {
  expect(
    tempoAttributeClauses([
      filter,
      { ...filter, operator: '<', value: '600' },
      {
        ...filter,
        scope: 'resource',
        key: 'enabled',
        type: 'boolean',
        operator: '=',
        value: 'false',
      },
      { ...filter, scope: 'unscoped', key: 'ratio', type: 'float', operator: '<=', value: '1' },
      { ...filter, key: 'sequence', value: '9007199254740993' },
    ])
  ).toEqual([
    'span.http.status_code >= 500',
    'span.http.status_code < 600',
    'resource.enabled = false',
    '.ratio <= 1.0',
    'span.sequence >= 9007199254740993',
  ]);
});
it('quotes strings and regexes as literals, including empty strings and query-like text', () => {
  const literal = '" } || { true } #\\\n';
  expect(
    tempoAttributeClauses([
      { ...filter, key: 'name', type: 'string', operator: '=', value: literal },
      { ...filter, type: 'string', operator: '!=', value: '' },
      { ...filter, key: 'http.route', type: 'string', operator: '=~', value: '/reviews/[0-9]+' },
      {
        ...filter,
        key: 'service.name',
        scope: 'resource',
        type: 'string',
        operator: '>',
        value: 'api',
      },
    ])
  ).toEqual([
    `span.name = ${JSON.stringify(literal)}`,
    'span.http.status_code != ""',
    'span.http.route =~ "/reviews/[0-9]+"',
    'resource.service.name > "api"',
  ]);
});
it('encodes signed boundaries without requiring an overflowing positive lexer token', () => {
  expect(
    tempoAttributeClauses([
      { ...filter, value: '9223372036854775807' },
      { ...filter, value: '-9223372036854775808' },
    ])
  ).toEqual([
    'span.http.status_code >= 9223372036854775807',
    'span.http.status_code >= (-9223372036854775807 - 1)',
  ]);
});
it.each(['9223372036854775808', '-9223372036854775809', '01', '+1', '', ' 1', '1\n', '1.0', '1e1'])(
  'rejects invalid integer %j',
  value => {
    expect(() => tempoAttributeClauses([{ ...filter, value }])).toThrow();
  }
);
it.each(['NaN', 'Infinity', '1e309', '1e-999', '', '.1', '1.', '0x10', ' 1', '1\n'])(
  'rejects invalid float %j',
  value => {
    expect(() => tempoAttributeClauses([{ ...filter, type: 'float', value }])).toThrow();
  }
);
it('retains decimal/exponent text and validates boolean and operator compatibility', () => {
  for (const value of ['1.25', '-0.5', '1e3', '5e-324', '0e-999'])
    expect(tempoAttributeClauses([{ ...filter, type: 'float', value }])[0]).toBe(
      `span.http.status_code >= ${value}`
    );
  for (const bad of [
    { ...filter, type: 'boolean' as const, value: 'true' },
    { ...filter, type: 'boolean' as const, operator: '=' as const, value: 'True' },
    { ...filter, operator: '=~' as const, value: '500' },
    { ...filter, type: 'string' as const, operator: '!~' as const, value: '(?=x)' },
  ])
    expect(() => tempoAttributeClauses([bad])).toThrow();
});
it('rejects invalid keys, unknown scope/type/operator and exact count/value/regex bounds', () => {
  for (const key of ['', ' a', 'a\n', '\u007f', '\ud800', 'a'.repeat(257)])
    expect(() => tempoAttributeClauses([{ ...filter, key }])).toThrow();
  for (const patch of [{ scope: 'trace' }, { type: 'raw' }, { operator: '||' }]) {
    const invalid = { ...filter };
    Object.assign(invalid, patch);
    expect(() => tempoAttributeClauses([invalid])).toThrow();
  }
  expect(tempoAttributeClauses(Array.from({ length: 10 }, () => filter))).toHaveLength(10);
  expect(() => tempoAttributeClauses(Array.from({ length: 11 }, () => filter))).toThrow(
    'at most 10'
  );
  expect(
    tempoAttributeClauses([
      { ...filter, key: 'a'.repeat(256), type: 'string', value: 'x'.repeat(1024) },
    ])
  ).toHaveLength(1);
  expect(() =>
    tempoAttributeClauses([{ ...filter, type: 'string', value: 'x'.repeat(1025) }])
  ).toThrow();
  expect(
    tempoAttributeClauses([{ ...filter, type: 'string', operator: '=~', value: 'x'.repeat(512) }])
  ).toHaveLength(1);
  expect(() =>
    tempoAttributeClauses([{ ...filter, type: 'string', operator: '=~', value: 'x'.repeat(513) }])
  ).toThrow();
});
it.each([
  'http/request-header',
  'customer tier',
  'unicode.\u00e9',
  '\ud83d\ude00',
  '0.name',
  'a = "b" } || { true',
  'quote"slash\\',
  'span:name',
  'resource.x/field',
  'event."name"',
  'a(b)&c^d,e',
  'back`tick',
  '\u00e9'.repeat(256),
])(
  'quotes the complete literal key %j without treating punctuation as scope or predicates',
  key => {
    const name = JSON.stringify(key);
    expect(tempoAttributeIdentifier(key)).toBe(name);
    for (const scope of TRACE_ATTRIBUTE_SCOPES)
      expect(tempoAttributeClauses([{ ...filter, scope, key }])).toEqual([
        `${scope === 'unscoped' ? '' : scope}.${name} >= 500`,
      ]);
    const url = new URL(
      traceSearchPath('tempo', { ...query, tags: [{ key, value: 'literal' }] }),
      'http://example.test'
    );
    expect(url.searchParams.get('q')).toBe(`{ .service.name = "reviews" && .${name} = "literal" }`);
  }
);
it.each([
  '',
  'a\nb',
  'a\tb',
  ' a',
  'a ',
  'a\u0085b',
  '\ud800',
  '\udc00',
  'a\u2028b',
  'a\u2029b',
  'a'.repeat(257),
])('rejects control, malformed Unicode and bounded-name violations %j in both Tempo paths', key => {
  expect(() => tempoAttributeIdentifier(key)).toThrow('attribute names');
  expect(() => tempoAttributeClauses([{ ...filter, key }])).toThrow();
  expect(() => traceSearchPath('tempo', { ...query, tags: [{ key, value: 'literal' }] })).toThrow();
});
it('keeps legacy simple keys unchanged and counts literal duplicate tags before quoting', () => {
  for (const key of ['http.status_code', 'name', '__proto__', 'a'.repeat(256)])
    expect(tempoAttributeIdentifier(key)).toBe(key);
  expect(() =>
    traceSearchPath('tempo', {
      ...query,
      tags: [
        { key: 'a/b', value: 'one' },
        { key: 'a/b', value: 'two' },
      ],
    })
  ).toThrow('Duplicate');
  expect(
    tempoAttributeClauses([{ ...filter, key: 'a/b', type: 'nil', operator: '!=', value: '' }])
  ).toEqual(['span."a/b" != nil']);
});
it.each(
  (['event', 'link', 'instrumentation'] as const).flatMap(scope =>
    TRACE_ATTRIBUTE_TYPES.flatMap(type =>
      TRACE_ATTRIBUTE_OPERATORS.map(operator => ({ scope, type, operator }))
    )
  )
)('retains $scope scope for $type $operator', ({ scope, type, operator }) => {
  const values = {
    string: 'literal',
    integer: '9007199254740993',
    float: '1.25',
    boolean: 'false',
    nil: '',
  };
  const item = { scope, type, operator, value: values[type], key: 'name/with:punctuation' };
  if (!traceAttributeOperatorAllowed(type, operator)) {
    expect(() => tempoAttributeClauses([item])).toThrow('Unsupported');
    return;
  }
  const literal = type === 'string' ? '"literal"' : type === 'nil' ? 'nil' : values[type];
  expect(tempoAttributeClauses([item])).toEqual([
    `${scope}."name/with:punctuation" ${operator} ${literal}`,
  ]);
});

it('combines event/link/instrumentation attributes without relabeling them as intrinsics', () => {
  const tempoFilters: TempoAttributeFilter[] = [
    { ...filter, scope: 'event', key: 'name', type: 'string', operator: '=', value: 'exception' },
    { ...filter, scope: 'link', key: 'span:id', type: 'string', operator: '=', value: 'literal' },
    {
      ...filter,
      scope: 'instrumentation',
      key: 'library.version',
      type: 'nil',
      operator: '!=',
      value: '',
    },
  ];
  const url = new URL(traceSearchPath('tempo', { ...query, tempoFilters }), 'http://example.test');
  expect(url.searchParams.get('q')).toBe(
    '{ .service.name = "reviews" && event.name = "exception" && link."span:id" = "literal" && instrumentation.library.version != nil }'
  );
  expect(() => traceSearchPath('jaeger', { ...query, tempoFilters })).toThrow('require Tempo');
  expect(() => tempoAttributeClauses(Array(11).fill(tempoFilters[0]))).toThrow('at most 10');
});

it('combines typed comparisons with existing filters, rejects Jaeger use and retains the URL budget', () => {
  const request = {
    ...query,
    operation: 'GET /reviews',
    errorsOnly: true,
    tags: [{ key: 'custom.tag', value: 'literal' }],
    tempoFilters: [filter],
  };
  const url = new URL(traceSearchPath('tempo', request), 'http://example.test');
  expect(url.searchParams.get('q')).toBe(
    '{ .service.name = "reviews" && name = "GET /reviews" && status = error && .custom.tag = "literal" && span.http.status_code >= 500 }'
  );
  expect(url.searchParams.get('start')).toBe(String(query.start));
  expect(() => traceSearchPath('jaeger', request)).toThrow('require Tempo');
  expect(() =>
    traceSearchPath('tempo', {
      ...query,
      tempoFilters: Array.from({ length: 10 }, (_, index) => ({
        ...filter,
        key: `key${index}`,
        type: 'string' as const,
        operator: '=' as const,
        value: '\n'.repeat(1024),
      })),
    })
  ).toThrow('16 KiB');
});

it('distinguishes missing/null, present/non-null, empty string and false without implicit coercion', () => {
  expect(
    tempoAttributeClauses([
      { ...filter, key: 'optional', type: 'nil', operator: '=', value: '' },
      { ...filter, key: 'required', scope: 'resource', type: 'nil', operator: '!=', value: '' },
      { ...filter, key: 'text', type: 'string', operator: '=', value: '' },
      { ...filter, key: 'flag', type: 'boolean', operator: '=', value: 'false' },
    ])
  ).toEqual([
    'span.optional = nil',
    'resource.required != nil',
    'span.text = ""',
    'span.flag = false',
  ]);
  expect(() =>
    tempoAttributeClauses([{ ...filter, type: 'nil', operator: '=', value: 'nil' }])
  ).toThrow('do not take a value');
  expect(() =>
    tempoAttributeClauses([{ ...filter, type: 'nil', operator: '>', value: '' }])
  ).toThrow('Unsupported');
});
