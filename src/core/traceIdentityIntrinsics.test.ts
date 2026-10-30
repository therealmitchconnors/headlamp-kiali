import { tempoIntrinsicClauses, traceIntrinsicName } from './traceIntrinsics';
import { traceSearchPath } from './tracing';

it.each([
  ['traceId', 'trace:id', 32],
  ['spanId', 'span:id', 16],
  ['parentId', 'span:parentID', 16],
  ['linkTraceId', 'link:traceID', 32],
  ['linkSpanId', 'link:spanID', 16],
] as const)(
  'uses bounded literal hex and equality-only storage predicates for %s',
  (field, name, width) => {
    expect(traceIntrinsicName(field)).toBe(name);
    for (const value of ['', '0', '000AbC', 'f'.repeat(width), '0'.repeat(width)]) {
      for (const operator of ['=', '!='] as const) {
        expect(tempoIntrinsicClauses([{ field, operator, value }])).toEqual([
          `${name} ${operator} ${JSON.stringify(value)}`,
        ]);
      }
    }
    for (const value of [
      'g',
      '0x1',
      '-1',
      '+1',
      ' ab',
      'ab ',
      'ab\n',
      'ab\r',
      'a/b=',
      'ab" || true',
      'f'.repeat(width + 1),
    ]) {
      expect(() => tempoIntrinsicClauses([{ field, operator: '=', value }])).toThrow('hexadecimal');
    }
    for (const operator of ['>', '>=', '<', '<=', '=~', '!~'] as const)
      expect(() => tempoIntrinsicClauses([{ field, operator, value: 'abc' }])).toThrow(
        'Unsupported'
      );
  }
);

it.each([
  ['0ns', '0ns'],
  ['-0ns', '0ns'],
  ['1.5ms', '1500000ns'],
  ['-1.5ms', '-1500000ns'],
  ['-0.001us', '-1ns'],
  ['-0.000000001h', '-3600ns'],
  ['-9007199254740993ns', '-9007199254740993ns'],
  ['-9223372036854775807ns', '-9223372036854775807ns'],
  ['9223372036854775807ns', '9223372036854775807ns'],
])('serializes event offset %s exactly without float duration arithmetic', (value, expected) => {
  expect(tempoIntrinsicClauses([{ field: 'eventTimeSinceStart', operator: '>=', value }])).toEqual([
    `event:timeSinceStart >= ${expected}`,
  ]);
});
it.each([
  '',
  '+1ms',
  '--1ms',
  '-01ms',
  '-1h30m',
  '-1',
  '-0.1ns',
  '-0.0000000001s',
  '1e3ns',
  ' 1ns',
  '-1ns\n',
  '-9223372036854775808ns',
  '9223372036854775808ns',
])('rejects invalid or not directly representable event offset %j', value =>
  expect(() =>
    tempoIntrinsicClauses([{ field: 'eventTimeSinceStart', operator: '=', value }])
  ).toThrow('Event offset')
);
it('keeps negative event offsets distinct from nonnegative span and trace durations', () => {
  for (const field of ['duration', 'traceDuration'] as const)
    expect(() => tempoIntrinsicClauses([{ field, operator: '=', value: '-1ns' }])).toThrow(
      'nonnegative'
    );
  for (const operator of ['=~', '!~'] as const)
    expect(() =>
      tempoIntrinsicClauses([{ field: 'eventTimeSinceStart', operator, value: '1ns' }])
    ).toThrow('Unsupported');
});
it('composes IDs and event offsets without link traversal or losing trace-service scope', () => {
  const query = {
    service: 'reviews',
    start: 1700000000,
    end: 1700000900,
    limit: 20,
    tempoIntrinsics: [
      { field: 'traceId' as const, operator: '=' as const, value: '00AbC' },
      { field: 'spanId' as const, operator: '!=' as const, value: '' },
      { field: 'parentId' as const, operator: '=' as const, value: '0' },
      { field: 'linkTraceId' as const, operator: '=' as const, value: 'def' },
      { field: 'linkSpanId' as const, operator: '!=' as const, value: 'ff' },
      { field: 'eventTimeSinceStart' as const, operator: '<' as const, value: '-1ns' },
    ],
  };
  const url = new URL(traceSearchPath('tempo', query), 'http://example.test');
  expect(url.pathname).toBe('/api/search');
  expect(url.searchParams.get('q')).toBe(
    '{ .service.name = "reviews" && trace:id = "00AbC" && span:id != "" && span:parentID = "0" && link:traceID = "def" && link:spanID != "ff" && event:timeSinceStart < -1ns }'
  );
  expect(() => traceSearchPath('jaeger', query)).toThrow('require Tempo');
});
