import { TEMPO_SPAN_RELATIONS, tempoRelatedSpanClause } from './traceRelations';
import { TraceQuery, traceSearchPath } from './tracing';

const query: TraceQuery = {
  service: 'reviews',
  operation: 'GET /reviews',
  errorsOnly: true,
  start: 1700000000,
  end: 1700000900,
  limit: 20,
  tempoFilters: [
    { scope: 'span', key: 'http.method', type: 'string', operator: '=', value: 'GET' },
  ],
  tempoIntrinsics: [{ field: 'duration', operator: '>=', value: '1ms' }],
};
it.each(TEMPO_SPAN_RELATIONS)(
  'keeps the primary and related scopes separate for $value',
  ({ value, operator }) => {
    const related = {
      relation: value,
      service: 'ratings',
      operation: 'GET /ratings',
      errorsOnly: true,
    };
    expect(tempoRelatedSpanClause(related)).toBe(
      `${operator} { .service.name = "ratings" && span:name = "GET /ratings" && span:status = error }`
    );
    const url = new URL(
      traceSearchPath('tempo', { ...query, tempoRelatedSpan: related }),
      'http://example.test'
    );
    expect(url.searchParams.get('q')).toBe(
      `{ .service.name = "reviews" && name = "GET /reviews" && status = error && span.http.method = "GET" && span:duration >= 1000000ns } ${operator} { .service.name = "ratings" && span:name = "GET /ratings" && span:status = error }`
    );
    expect(url.searchParams.get('start')).toBe('1700000000');
    expect(url.searchParams.get('end')).toBe('1700000900');
    expect(url.searchParams.get('limit')).toBe('20');
    expect(url.searchParams.get('spss')).toBe('1');
  }
);
it('preserves primary-only requests and literal secondary strings without injecting query syntax', () => {
  expect(tempoRelatedSpanClause(undefined)).toBeUndefined();
  expect(traceSearchPath('tempo', { ...query, tempoRelatedSpan: undefined })).toBe(
    traceSearchPath('tempo', query)
  );
  const text = '" } || { true }\\\n';
  expect(
    tempoRelatedSpanClause({ relation: 'and', service: text, operation: text, errorsOnly: false })
  ).toBe(`&& { .service.name = ${JSON.stringify(text)} && span:name = ${JSON.stringify(text)} }`);
  expect(tempoRelatedSpanClause({ relation: 'and', service: 'x', operation: '' })).toBe(
    '&& { .service.name = "x" }'
  );
});
it.each([
  null,
  [],
  {},
  { relation: 'and', service: '' },
  { relation: 'and', service: ' ' },
  { relation: 'and', service: 1 },
  { relation: 'and', service: 'x'.repeat(257) },
  { relation: 'and', service: 'x', operation: null },
  { relation: 'and', service: 'x', operation: 'x'.repeat(257) },
  { relation: 'and', service: 'x', errorsOnly: 'true' },
  { relation: 'and', service: 'x', query: '{ true }' },
  { relation: 'or', service: 'x' },
  { relation: '>> {true}', service: 'x' },
])('rejects invalid related filters instead of dropping or broadening them %#', value => {
  expect(() => tempoRelatedSpanClause(value)).toThrow();
});
it('keeps related groups Tempo-only and inside the single shared encoded URL budget', () => {
  const base = { ...query, tempoFilters: [], tempoIntrinsics: [] };
  const tempoRelatedSpan = { relation: 'and' as const, service: 'ratings' };
  expect(() => traceSearchPath('jaeger', { ...base, tempoRelatedSpan })).toThrow(
    'Related span filters require Tempo'
  );
  const nearLimit = {
    ...base,
    tempoIntrinsics: [1024, 1024, 500].map(count => ({
      field: 'name' as const,
      operator: '=' as const,
      value: '\\'.repeat(count),
    })),
  };
  expect(traceSearchPath('tempo', nearLimit).length).toBeLessThanOrEqual(16384);
  expect(() =>
    traceSearchPath('tempo', {
      ...nearLimit,
      tempoRelatedSpan: { ...tempoRelatedSpan, service: '\\'.repeat(256) },
    })
  ).toThrow('16 KiB');
});
