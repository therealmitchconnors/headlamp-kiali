import fixtureText from '../../test-files/tracing/fixtures.json?raw';
import {
  decodeTraceDetail,
  decodeTraceSearch,
  traceDate,
  traceId,
  TraceNotFoundError,
  TraceQuery,
  traceSearchPath,
} from './tracing';

const fixtures = () => JSON.parse(fixtureText);
const trace = '00000000000000000000000000000001';
const query = {
  service: 'reviews.bookinfo',
  start: 1700000000,
  end: 1700000900,
  limit: 20,
  minDurationMs: 1.25,
  errorsOnly: true,
};

it('constructs escaped provider-specific searches with correct time and duration units', () => {
  const jaeger = new URL(traceSearchPath('jaeger', query), 'http://example.test');
  expect(jaeger.pathname).toBe('/api/traces');
  expect(jaeger.searchParams.get('start')).toBe('1700000000000000');
  expect(jaeger.searchParams.get('minDuration')).toBe('1250us');
  expect(JSON.parse(jaeger.searchParams.get('tags')!)).toEqual({ error: 'true' });
  const service = 'reviews" } || { true } #\n\\';
  const tempo = new URL(
    traceSearchPath('tempo', { ...query, service, operation: 'GET /reviews' }),
    'http://example.test'
  );
  expect(tempo.pathname).toBe('/api/search');
  expect(tempo.searchParams.get('start')).toBe('1700000000');
  expect(tempo.searchParams.get('q')).toBe(
    `{ .service.name = ${JSON.stringify(service)} && name = "GET /reviews" && status = error }`
  );
  expect(tempo.searchParams.get('minDuration')).toBe('1.25ms');
});
it('encodes literal string tags without permitting raw TraceQL and preserves empty values', () => {
  const tags = [
    { key: 'http.method', value: 'GET' },
    { key: 'custom', value: '" } || { true } #\n\\' },
    { key: 'empty', value: '' },
  ];
  const jaeger = new URL(traceSearchPath('jaeger', { ...query, tags }), 'http://example.test');
  expect(JSON.parse(jaeger.searchParams.get('tags')!)).toEqual({
    'http.method': 'GET',
    custom: tags[1].value,
    empty: '',
    error: 'true',
  });
  const tempo = new URL(traceSearchPath('tempo', { ...query, tags }), 'http://example.test');
  expect(tempo.searchParams.get('q')).toBe(
    `{ .service.name = "reviews.bookinfo" && status = error && .http.method = "GET" && .custom = ${JSON.stringify(
      tags[1].value
    )} && .empty = "" }`
  );
  expect(tags).toHaveLength(3);
});
it('maps explicit error tags without overriding contradictory filters or declaring unset status healthy', () => {
  for (const value of ['true', 'false']) {
    const request = { ...query, errorsOnly: false, tags: [{ key: 'error', value }] };
    const tempo = new URL(traceSearchPath('tempo', request), 'http://example.test');
    expect(tempo.searchParams.get('q')).toContain(
      value === 'true' ? 'status = error' : 'status != error'
    );
    const jaeger = new URL(traceSearchPath('jaeger', request), 'http://example.test');
    expect(JSON.parse(jaeger.searchParams.get('tags')!)).toEqual({ error: value });
  }
  const same = new URL(
    traceSearchPath('tempo', { ...query, tags: [{ key: 'error', value: 'true' }] }),
    'http://example.test'
  );
  expect(same.searchParams.get('q')!.match(/status = error/g)).toHaveLength(1);
  expect(() =>
    traceSearchPath('jaeger', { ...query, tags: [{ key: 'error', value: 'false' }] })
  ).toThrow(/conflicts/);
});
it('supports literal Jaeger and quoted Tempo keys without prototype changes or query syntax', () => {
  const tags = [
    { key: '__proto__', value: 'literal' },
    { key: 'http/header', value: 'value' },
  ];
  const jaeger = new URL(traceSearchPath('jaeger', { ...query, tags }), 'http://example.test');
  expect(JSON.parse(jaeger.searchParams.get('tags')!)['__proto__']).toBe('literal');
  const tempo = new URL(traceSearchPath('tempo', { ...query, tags }), 'http://example.test');
  expect(tempo.searchParams.get('q')).toContain(
    '.__proto__ = "literal" && ."http/header" = "value"'
  );
  const key = 'a = "b" } || { true';
  const escaped = new URL(
    traceSearchPath('tempo', { ...query, tags: [{ key, value: 'x' }] }),
    'http://example.test'
  );
  expect(escaped.searchParams.get('q')).toBe(
    `{ .service.name = "reviews.bookinfo" && status = error && .${JSON.stringify(key)} = "x" }`
  );
});
it.each([
  null,
  {},
  [{ key: '', value: 'x' }],
  [{ key: ' tag', value: 'x' }],
  [{ key: 'tag\n', value: 'x' }],
  [{ key: 'tag\u0000key', value: 'x' }],
  [{ key: 'tag', value: true }],
  [{ key: 'tag', value: 1 }],
  [{ key: 'tag', value: 'x'.repeat(1025) }],
  [{ key: 'k'.repeat(257), value: 'x' }],
  [{ key: 'error', value: 'yes' }],
  [
    { key: 'tag', value: 'a' },
    { key: 'tag', value: 'b' },
  ],
  Array.from({ length: 11 }, (_, i) => ({ key: `k${i}`, value: '' })),
])('rejects invalid tag filters %#', tags => {
  expect(() => traceSearchPath('jaeger', { ...query, tags } as TraceQuery)).toThrow();
});
it('bounds encoded search size as well as tag counts and character lengths', () => {
  const tags = Array.from({ length: 10 }, (_, index) => ({
    key: `tag${index}`,
    value: '\u4e00'.repeat(1024),
  }));
  expect(() => traceSearchPath('tempo', { ...query, tags })).toThrow(/16 KiB/);
  expect(() => traceSearchPath('jaeger', { ...query, tags })).toThrow(/16 KiB/);
  const valid = Array.from({ length: 10 }, (_, index) => ({ key: `tag${index}`, value: '' }));
  expect(traceSearchPath('tempo', { ...query, tags: valid })).toContain('/api/search?');
});
it.each([
  { service: '' },
  { limit: 0 },
  { limit: 101 },
  { start: 0 },
  { start: query.end },
  { end: query.start + 86401 },
  { minDurationMs: NaN },
])('rejects invalid trace search %#', changes =>
  expect(() => traceSearchPath('jaeger', { ...query, ...changes })).toThrow()
);
it('normalizes Jaeger spans, processes, logs, flags and warnings without declaring missing status healthy', () => {
  const result = decodeTraceDetail('jaeger', fixtures().jaeger, trace);
  expect(result).toMatchObject({
    id: trace,
    service: 'productpage',
    operation: 'GET /productpage',
    spanCount: 2,
    errorSpans: 1,
    startNs: '1700000000000000000',
    durationNs: '1000000',
  });
  expect(result.spans[0].attributes).toContainEqual({ key: 'zero', type: 'int64', value: 0 });
  expect(result.spans[1].parentId).toBe('0000000000000001');
  expect(result.spans[1].events[0]).toMatchObject({
    timestampNs: '1700000000000150000',
    name: 'Log',
  });
  expect(result.warnings).toContain('Synthetic fixture; not a live trace');
});
it('preserves OTLP nanosecond precision, base64/hex identities and typed resource attributes', () => {
  const result = decodeTraceDetail('tempo', fixtures().tempoTrace, trace);
  expect(result.startNs).toBe('1700000000000000001');
  expect(result.durationNs).toBe('1000');
  expect(result.spans[1]).toMatchObject({
    id: '0000000000000002',
    parentId: '0000000000000001',
    durationNs: '80',
    error: true,
  });
  expect(result.spans[0].resourceAttributes).toContainEqual({
    key: 'exact.counter',
    value: '9007199254740993',
  });
  expect(result.spans[0].attributes[0].value).toEqual([false, 0]);
  expect(traceDate(result.startNs).getTime()).toBe(1700000000000);
  const standard = { resourceSpans: fixtures().tempoTrace.batches };
  expect(decodeTraceDetail('tempo', standard, trace).spans).toHaveLength(2);
});
it('keeps search summaries distinct from complete trace details and signals limits', () => {
  const jaeger = decodeTraceSearch('jaeger', fixtures().jaeger, 1);
  expect(jaeger.traces[0].spanCount).toBe(2);
  expect(jaeger.warnings.some(warning => warning.includes('limit'))).toBe(true);
  const tempo = decodeTraceSearch('tempo', fixtures().tempoSearch, 20);
  expect(tempo.traces[0]).toMatchObject({ durationNs: '1000000', matchedSpans: 2 });
  expect(tempo.traces[0].spanCount).toBeUndefined();
  expect(decodeTraceSearch('tempo', { traces: [] }, 20).traces).toEqual([]);
});
it('distinguishes not-found traces from mismatched IDs, malformed data and unsafe timestamps', () => {
  expect(() => decodeTraceDetail('jaeger', { data: [] }, trace)).toThrow(TraceNotFoundError);
  expect(() => decodeTraceDetail('jaeger', fixtures().jaeger, '2')).toThrow('does not match');
  expect(() => traceId('../other')).toThrow();
  expect(() => traceId('0')).toThrow();
  const bad = fixtures().jaeger;
  bad.data[0].spans[0].startTime = Number.MAX_SAFE_INTEGER + 1;
  expect(() => decodeTraceDetail('jaeger', bad, trace)).toThrow('Unsafe');
  const backwards = fixtures().tempoTrace;
  backwards.batches[0].scopeSpans[0].spans[0].endTimeUnixNano = '1';
  expect(() => decodeTraceDetail('tempo', backwards, trace)).toThrow('ends before');
  const invalidParent = fixtures().tempoTrace;
  invalidParent.batches[0].scopeSpans[0].spans[1].parentSpanId = 123;
  expect(() => decodeTraceDetail('tempo', invalidParent, trace)).toThrow('parent span identity');
});
it('rejects duplicate IDs, retains missing parents and warns about cycles without fabricating a hierarchy', () => {
  const duplicate = fixtures().jaeger;
  duplicate.data[0].spans.push(duplicate.data[0].spans[0]);
  expect(() => decodeTraceDetail('jaeger', duplicate, trace)).toThrow('duplicate');
  const missing = fixtures().jaeger;
  missing.data[0].spans[1].references[0].spanID = '3';
  expect(
    decodeTraceDetail('jaeger', missing, trace).warnings.some(w => w.includes('missing'))
  ).toBe(true);
  const cycle = fixtures().jaeger;
  cycle.data[0].spans[0].references = [{ refType: 'CHILD_OF', traceID: trace, spanID: '2' }];
  expect(decodeTraceDetail('jaeger', cycle, trace).warnings.some(w => w.includes('cycle'))).toBe(
    true
  );
});
it('enforces explicit response and attribute budgets', () => {
  const many = fixtures().jaeger;
  many.data[0].spans = Array.from({ length: 2001 }, () => many.data[0].spans[0]);
  expect(() => decodeTraceDetail('jaeger', many, trace)).toThrow('oversized');
  expect(() =>
    decodeTraceSearch(
      'tempo',
      { traces: Array.from({ length: 101 }, () => fixtures().tempoSearch.traces[0]) },
      100
    )
  ).toThrow('limit');
  const tags = fixtures().jaeger;
  tags.data[0].spans[0].tags = Array.from({ length: 257 }, () => ({ key: 'x', value: 1 }));
  expect(() => decodeTraceDetail('jaeger', tags, trace)).toThrow('attributes');
});

it('does not present backend errors as an empty successful search', () => {
  expect(() =>
    decodeTraceSearch('jaeger', { data: [], errors: [{ msg: 'Storage unavailable' }] }, 20)
  ).toThrow('Storage unavailable');
  const partial = fixtures().jaeger;
  partial.errors = [{ msg: 'One storage shard unavailable' }];
  expect(decodeTraceSearch('jaeger', partial, 20).warnings).toContain(
    'One storage shard unavailable'
  );
  const unknown = fixtures().jaeger;
  unknown.data[0].spans[0].tags = [];
  expect(decodeTraceDetail('jaeger', unknown, trace).spans[0].error).toBeNull();
});

it('rejects event/summary overflow and duplicate nested OTLP keys without losing values', () => {
  const overflow = fixtures().jaeger;
  overflow.data[0].spans[1].logs[0].timestamp = '18446744073709552';
  expect(() => decodeTraceDetail('jaeger', overflow, trace)).toThrow('uint64');
  const summary = fixtures().tempoSearch;
  summary.traces[0].startTimeUnixNano = '18446744073709551615';
  expect(() => decodeTraceSearch('tempo', summary, 20)).toThrow('uint64');
  const duplicate = fixtures().tempoTrace;
  duplicate.batches[0].scopeSpans[0].spans[0].attributes = [
    {
      key: 'map',
      value: {
        kvlistValue: {
          values: [
            { key: 'key', value: { stringValue: 'first' } },
            { key: 'key', value: { stringValue: 'second' } },
          ],
        },
      },
    },
  ];
  expect(() => decodeTraceDetail('tempo', duplicate, trace)).toThrow('Duplicate OTLP map key');
});

it.each([
  { value: { intValue: '9223372036854775808' } },
  { value: { intValue: Number.MAX_SAFE_INTEGER + 1 } },
  { value: { stringValue: 'x', boolValue: true } },
  { value: { doubleValue: Infinity } },
  { value: { boolValue: 'false' } },
])('rejects invalid OTLP value variants %#', ({ value }) => {
  const response = fixtures().tempoTrace;
  response.batches[0].scopeSpans[0].spans[0].attributes = [{ key: 'invalid', value }];
  expect(() => decodeTraceDetail('tempo', response, trace)).toThrow();
});

it('bounds nested values and preserves dropped-data notices and unresolved status', () => {
  const response = fixtures().tempoTrace;
  const span = response.batches[0].scopeSpans[0].spans[0];
  span.status = {};
  span.droppedEventsCount = 1;
  const detail = decodeTraceDetail('tempo', response, trace);
  expect(detail.spans[0].error).toBeNull();
  expect(detail.warnings).toContain('The provider reports dropped span data');
  let value: unknown = { stringValue: 'leaf' };
  for (let depth = 0; depth < 12; depth++) value = { arrayValue: { values: [value] } };
  span.attributes = [{ key: 'nested', value }];
  expect(() => decodeTraceDetail('tempo', response, trace)).toThrow('oversized');
});
