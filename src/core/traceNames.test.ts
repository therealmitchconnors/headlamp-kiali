import { decodeTraceNames, TraceNameQuery, traceNamesPath } from './traceNames';

const window = { start: 1700000000, end: 1700000900 };
it('uses Jaeger query parameters rather than path interpolation for operation service names', () => {
  expect(traceNamesPath('jaeger', { ...window, kind: 'services' })).toBe('/api/services');
  const service = 'shop / # ? & + "';
  const url = new URL(
    traceNamesPath('jaeger', { ...window, kind: 'operations', service }),
    'http://example.test'
  );
  expect(url.pathname).toBe('/api/operations');
  expect([...url.searchParams]).toEqual([['service', service]]);
});
it('uses Tempo typed values, epoch seconds and a literal single-spanset service filter', () => {
  const service = 'shop" } || { true } // \\';
  for (const kind of ['services', 'operations'] as const) {
    const url = new URL(
      traceNamesPath('tempo', { ...window, kind, service }),
      'http://example.test'
    );
    expect(url.pathname).toBe(
      `/api/v2/search/tag/${kind === 'services' ? '.service.name' : 'name'}/values`
    );
    expect(url.searchParams.get('start')).toBe('1700000000');
    expect(url.searchParams.get('end')).toBe('1700000900');
    expect(url.searchParams.get('limit')).toBe('1000');
    expect(url.searchParams.get('q')).toBe(
      kind === 'services' ? null : `{ .service.name = ${JSON.stringify(service)} }`
    );
  }
});
it.each([
  { start: 0 },
  { start: NaN },
  { end: window.start },
  { end: window.start + 86401 },
  { end: Infinity },
  { end: window.end + 0.1 },
  { kind: 'unknown' },
  { kind: 'operations', service: '' },
  { kind: 'operations', service: 'a'.repeat(257) },
  { kind: 'operations', service: 'name\n' },
])('rejects invalid discovery inputs %#', override => {
  expect(() =>
    traceNamesPath('tempo', { ...window, kind: 'services', ...override } as TraceNameQuery)
  ).toThrow();
});
it('accepts the exact name and time-range boundaries', () => {
  expect(
    traceNamesPath('tempo', { start: 1, end: 86401, kind: 'operations', service: 'a'.repeat(256) })
  ).toContain('/name/values?');
});
it('preserves string values and deduplicates operations across span kinds', () => {
  expect(
    decodeTraceNames('jaeger', 'services', { data: ['shop', 'a', 'shop'], errors: null })
  ).toEqual(['a', 'shop']);
  expect(
    decodeTraceNames('jaeger', 'operations', {
      data: [
        { name: 'GET /', spanKind: 'server' },
        { name: 'GET /', spanKind: 'client' },
        { name: 'POST /' },
      ],
    })
  ).toEqual(['GET /', 'POST /']);
  expect(
    decodeTraceNames('tempo', 'services', { tagValues: [{ type: 'string', value: '003' }] })
  ).toEqual(['003']);
  expect(decodeTraceNames('tempo', 'operations', { tagValues: [] })).toEqual([]);
});
it.each([
  {},
  { data: null },
  { data: [1] },
  { data: [''] },
  { data: [' \t'] },
  { data: ['a\n'] },
  { data: ['a'.repeat(257)] },
  { data: [], errors: [{ msg: 'Failure' }] },
  { data: [], errors: false },
])('rejects malformed or error-bearing service envelopes %#', response => {
  expect(() => decodeTraceNames('jaeger', 'services', response)).toThrow();
});
it.each([
  { tagValues: ['not a typed value'] },
  { tagValues: [{ type: 'int', value: '42' }] },
  { tagValues: [{ type: 'string', value: false }] },
  { tagValues: [{ value: 'missing type' }] },
  { tagValues: [{ type: 'string' }] },
])('never infers string values from other Tempo types %#', response => {
  expect(() => decodeTraceNames('tempo', 'services', response)).toThrow();
});
it('rejects the legacy Jaeger operation shape rather than guessing endpoint compatibility', () => {
  expect(() => decodeTraceNames('jaeger', 'operations', { data: ['GET /'] })).toThrow();
});
it('enforces the raw entry bound before deduplication and preserves all 1000 allowed names', () => {
  const data = Array.from({ length: 1000 }, (_, i) => `service-${i}`);
  expect(decodeTraceNames('jaeger', 'services', { data })).toHaveLength(1000);
  expect(() => decodeTraceNames('jaeger', 'services', { data: Array(1001).fill('same') })).toThrow(
    /1,000/
  );
});
