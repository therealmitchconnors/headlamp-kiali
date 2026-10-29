import { tempoAttributeClauses, TRACE_ATTRIBUTE_OPERATORS } from './traceFilters';
import {
  TEMPO_INTRINSICS,
  TEMPO_SPAN_KINDS,
  TEMPO_SPAN_STATUSES,
  tempoIntrinsicClauses,
  TempoIntrinsicFilter,
  traceIntrinsicName,
} from './traceIntrinsics';
import { traceSearchPath } from './tracing';

const filter: TempoIntrinsicFilter = { field: 'duration', operator: '>=', value: '1.5ms' };
const query = { service: 'reviews', start: 1700000000, end: 1700000900, limit: 20 };

it.each([
  ['0ns', '0'],
  ['1ns', '1'],
  ['0.001us', '1'],
  ['0.000001ms', '1'],
  ['0.000000001s', '1'],
  ['1.5ms', '1500000'],
  ['1m', '60000000000'],
  ['0.000000001h', '3600'],
  ['1.5h', '5400000000000'],
  ['9007199254740993ns', '9007199254740993'],
  ['9223372036854775.807us', '9223372036854775807'],
  ['9223372036854775807ns', '9223372036854775807'],
])('normalizes %s to exact signed-range nanoseconds', (value, expected) => {
  for (const field of ['duration', 'traceDuration'] as const)
    expect(tempoIntrinsicClauses([{ ...filter, field, value }])).toEqual([
      `${field === 'duration' ? 'span' : 'trace'}:duration >= ${expected}ns`,
    ]);
});
it.each([
  '',
  ' 1ms',
  '1ms\n',
  '-1ms',
  '+1ms',
  '01ms',
  '1',
  '1MS',
  '1d',
  '1h30m',
  '1e3ms',
  '0.1ns',
  '0.0001us',
  '0.0000000001s',
  '9223372036854775808ns',
  '9223372036854775.808us',
  '1'.repeat(63) + 'ns',
  '1ms } || { true',
  'Infinityms',
])('rejects unsupported, lossy or overflowing duration %j', value => {
  for (const field of ['duration', 'traceDuration'] as const)
    expect(() => tempoIntrinsicClauses([{ ...filter, field, value }])).toThrow();
});
it.each(
  TEMPO_INTRINSICS.flatMap(field =>
    TRACE_ATTRIBUTE_OPERATORS.map(operator => ({ field, operator }))
  )
)('enforces field/operator compatibility: $field $operator', ({ field, operator }) => {
  const value =
    field === 'duration' || field === 'traceDuration'
      ? '1ns'
      : field === 'kind'
      ? 'server'
      : field === 'status'
      ? 'error'
      : 'name';
  const supported =
    field === 'kind' || field === 'status'
      ? ['=', '!='].includes(operator)
      : field === 'duration' || field === 'traceDuration'
      ? !['=~', '!~'].includes(operator)
      : true;
  if (supported) expect(tempoIntrinsicClauses([{ field, operator, value }])).toHaveLength(1);
  else expect(() => tempoIntrinsicClauses([{ field, operator, value }])).toThrow('Unsupported');
});
it('uses unquoted enum tokens while distinguishing intrinsics from same-named attributes', () => {
  for (const field of ['status', 'kind'] as const) {
    const values: readonly string[] = field === 'status' ? TEMPO_SPAN_STATUSES : TEMPO_SPAN_KINDS;
    for (const value of values)
      expect(tempoIntrinsicClauses([{ field, operator: '=', value }])).toEqual([
        `span:${field} = ${value}`,
      ]);
    for (const value of ['ERROR', 'nil', 'true', '"error"', '', 'error || true', 'error\n'])
      expect(() => tempoIntrinsicClauses([{ field, operator: '=', value }])).toThrow(
        'requires one of'
      );
  }
  expect(
    tempoAttributeClauses([
      { scope: 'span', key: 'status', type: 'string', operator: '=', value: 'error' },
    ])
  ).toEqual(['span.status = "error"']);
  expect(tempoIntrinsicClauses([{ field: 'statusMessage', operator: '=', value: '' }])).toEqual([
    'span:statusMessage = ""',
  ]);
});
it('quotes string predicates and shares bounded RE2 validation with attributes', () => {
  const value = '" } || { true }\\\n';
  expect(tempoIntrinsicClauses([{ field: 'name', operator: '=', value }])).toEqual([
    `span:name = ${JSON.stringify(value)}`,
  ]);
  expect(tempoIntrinsicClauses([{ field: 'name', operator: '!~', value: 'GET .*' }])).toEqual([
    'span:name !~ "GET .*"',
  ]);
  expect(() => tempoIntrinsicClauses([{ field: 'name', operator: '=~', value: '(?=x)' }])).toThrow(
    'RE2'
  );
  expect(
    tempoIntrinsicClauses([{ field: 'name', operator: '=~', value: 'x'.repeat(512) }])
  ).toHaveLength(1);
  expect(() =>
    tempoIntrinsicClauses([{ field: 'name', operator: '=~', value: 'x'.repeat(513) }])
  ).toThrow('512');
  expect(
    tempoIntrinsicClauses([{ field: 'name', operator: '=', value: 'x'.repeat(1024) }])
  ).toHaveLength(1);
  expect(() =>
    tempoIntrinsicClauses([{ field: 'name', operator: '=', value: 'x'.repeat(1025) }])
  ).toThrow('1024');
});
it('rejects unknown fields, invalid shapes, operators and count overflow', () => {
  for (const patch of [
    { field: 'name }' },
    { field: 'trace:duration' },
    { operator: '||' },
    { value: 1 },
  ]) {
    const invalid = { ...filter };
    Object.assign(invalid, patch);
    expect(() => tempoIntrinsicClauses([invalid])).toThrow();
  }
  expect(() => tempoIntrinsicClauses(JSON.parse('[null]'))).toThrow('Invalid');
  expect(() => tempoIntrinsicClauses(JSON.parse('{}'))).toThrow('at most 10');
  expect(tempoIntrinsicClauses(Array.from({ length: 10 }, () => filter))).toHaveLength(10);
  expect(() => tempoIntrinsicClauses(Array.from({ length: 11 }, () => filter))).toThrow(
    'at most 10'
  );
});
it('ANDs intrinsic predicates with existing scope/filters and rejects Jaeger and oversized requests', () => {
  const captured = {
    ...query,
    operation: 'GET /',
    errorsOnly: true,
    minDurationMs: 10,
    tags: [{ key: 'region', value: 'west' }],
    tempoFilters: [
      {
        scope: 'span' as const,
        key: 'status',
        type: 'string' as const,
        operator: '=' as const,
        value: 'custom',
      },
    ],
    tempoIntrinsics: [
      filter,
      { field: 'kind' as const, operator: '!=' as const, value: 'internal' },
    ],
  };
  const url = new URL(traceSearchPath('tempo', captured), 'http://example.test');
  expect(url.searchParams.get('q')).toBe(
    '{ .service.name = "reviews" && name = "GET /" && status = error && .region = "west" && span.status = "custom" && span:duration >= 1500000ns && span:kind != internal }'
  );
  expect(url.searchParams.get('minDuration')).toBe('10ms');
  expect(() => traceSearchPath('jaeger', { ...query, tempoIntrinsics: [filter] })).toThrow(
    'require Tempo'
  );
  expect(() =>
    traceSearchPath('tempo', {
      ...query,
      tempoIntrinsics: Array.from({ length: 10 }, () => ({
        field: 'name' as const,
        operator: '=' as const,
        value: '\n'.repeat(1024),
      })),
    })
  ).toThrow('16 KiB');
  expect(traceSearchPath('jaeger', { ...query, tempoIntrinsics: [] })).toBe(
    traceSearchPath('jaeger', query)
  );
});

it.each(['rootName', 'rootServiceName'] as const)(
  'serializes trace-wide %s using the canonical field and literal-string protection',
  field => {
    const name = field === 'rootName' ? 'trace:rootName' : 'trace:rootService';
    const value = 'root" } || { true }\\\n';
    expect(traceIntrinsicName(field)).toBe(name);
    expect(tempoIntrinsicClauses([{ field, operator: '=', value }])).toEqual([
      `${name} = ${JSON.stringify(value)}`,
    ]);
    expect(tempoIntrinsicClauses([{ field, operator: '=', value: '' }])).toEqual([`${name} = ""`]);
    expect(tempoIntrinsicClauses([{ field, operator: '=~', value: 'x'.repeat(512) }])).toHaveLength(
      1
    );
    expect(() =>
      tempoIntrinsicClauses([{ field, operator: '=~', value: 'x'.repeat(513) }])
    ).toThrow('512');
    expect(() => tempoIntrinsicClauses([{ field, operator: '=~', value: '(?=root)' }])).toThrow(
      'RE2'
    );
    expect(
      tempoIntrinsicClauses([{ field, operator: '>=', value: 'x'.repeat(1024) }])
    ).toHaveLength(1);
    expect(() =>
      tempoIntrinsicClauses([{ field, operator: '=', value: 'x'.repeat(1025) }])
    ).toThrow('1024');
  }
);
it('keeps span and trace durations and matched/root services distinct in one captured query', () => {
  const tempoIntrinsics: TempoIntrinsicFilter[] = [
    { field: 'duration', operator: '<', value: '1ms' },
    { field: 'traceDuration', operator: '>=', value: '2s' },
    { field: 'rootName', operator: '=~', value: 'GET .*' },
    { field: 'rootServiceName', operator: '=', value: 'productpage' },
  ];
  const path = traceSearchPath('tempo', { ...query, minDurationMs: 100, tempoIntrinsics });
  const url = new URL(path, 'http://example.test');
  expect(url.searchParams.get('q')).toBe(
    '{ .service.name = "reviews" && span:duration < 1000000ns && trace:duration >= 2000000000ns && trace:rootName =~ "GET .*" && trace:rootService = "productpage" }'
  );
  expect(url.searchParams.get('minDuration')).toBe('100ms');
  expect(() => traceSearchPath('jaeger', { ...query, tempoIntrinsics })).toThrow('require Tempo');
  expect(() => tempoIntrinsicClauses(Array.from({ length: 11 }, () => tempoIntrinsics[1]))).toThrow(
    'at most 10'
  );
  expect(() =>
    traceSearchPath('tempo', {
      ...query,
      tempoIntrinsics: Array.from({ length: 10 }, () => ({
        field: 'rootName',
        operator: '=',
        value: '\n'.repeat(1024),
      })),
    })
  ).toThrow('16 KiB');
});
