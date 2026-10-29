import fixtureText from '../../test-files/tracing/fixtures.json?raw';
import { TracingConfig } from './config';
import { decodeTraceDetail, TraceFlags, traceFlags, traceId } from './tracing';

const fixtures = () => JSON.parse(fixtureText);
const trace = '00000000000000000000000000000001';
const flagCases: {
  provider: TracingConfig['provider'];
  input: unknown;
  expected: TraceFlags | undefined;
}[] = [
  { provider: 'jaeger', input: undefined, expected: undefined },
  { provider: 'tempo', input: null, expected: undefined },
  {
    provider: 'jaeger',
    input: 0,
    expected: { raw: 0, sampled: false, debug: false, firehose: false },
  },
  {
    provider: 'jaeger',
    input: 3,
    expected: { raw: 3, sampled: true, debug: true, firehose: false },
  },
  {
    provider: 'jaeger',
    input: 8,
    expected: { raw: 8, sampled: false, debug: false, firehose: true },
  },
  { provider: 'tempo', input: 0, expected: { raw: 0, sampled: false, remote: undefined } },
  { provider: 'tempo', input: 256, expected: { raw: 256, sampled: false, remote: false } },
  { provider: 'tempo', input: 512, expected: { raw: 512, sampled: false, remote: undefined } },
  { provider: 'tempo', input: 769, expected: { raw: 769, sampled: true, remote: true } },
  {
    provider: 'tempo',
    input: '4294967295',
    expected: { raw: 4294967295, sampled: true, remote: true },
  },
  {
    provider: 'tempo',
    input: 2147483648,
    expected: { raw: 2147483648, sampled: false, remote: undefined },
  },
];
it.each(flagCases)(
  'preserves provider-specific flag presence and masks %#',
  ({ provider, input, expected }) => {
    expect(traceFlags(input, provider)).toEqual(expected);
  }
);
it.each([-1, 1.5, 4294967296, '4294967296', true, {}, '', '1\n', '0x1'])(
  'rejects invalid trace flags %#',
  input => {
    expect(() => traceFlags(input, 'tempo')).toThrow();
  }
);
it('retains explicit empty/zero metadata, exact scope/link attributes and remote-context uncertainty', () => {
  const result = decodeTraceDetail('tempo', fixtures().tempoTrace, trace);
  expect(result.spans[0]).toMatchObject({
    flags: { raw: 0, sampled: false },
    traceState: '',
    status: { code: 'STATUS_CODE_OK', message: '' },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    resourceDroppedAttributesCount: 0,
    resourceSchemaUrl: 'https://opentelemetry.io/schemas/1.26.0',
    scope: {
      name: 'synthetic',
      version: '1.0',
      schemaUrl: 'https://opentelemetry.io/schemas/1.25.0',
      droppedAttributesCount: 1,
    },
  });
  expect(result.spans[0].flags?.remote).toBeUndefined();
  expect(result.spans[0].scope?.attributes).toContainEqual({ key: 'scope.enabled', value: false });
  expect(result.spans[0].scope?.attributes).toContainEqual({
    key: 'scope.counter',
    value: '9007199254740993',
  });
  expect(result.spans[0].events[0].droppedAttributesCount).toBe(0);
  expect(result.spans[1]).toMatchObject({
    flags: { sampled: true, remote: true },
    traceState: 'vendor=synthetic',
    status: { code: 2, message: 'Synthetic upstream failure' },
  });
  expect(result.spans[1].references[0]).toMatchObject({
    flags: { sampled: false, remote: false },
    traceState: 'vendor=linked',
    droppedAttributesCount: 2,
  });
  expect(result.spans[1].references[0].attributes).toContainEqual({
    key: 'link.counter',
    value: '9007199254740993',
  });
  expect(result.warnings).toContain('The provider reports dropped scope attributes');
  expect(result.warnings).toContain('The provider reports dropped link attributes');
  expect(decodeTraceDetail('jaeger', fixtures().jaeger, trace).spans[1].flags).toMatchObject({
    sampled: true,
    debug: true,
  });
});
it('supports legacy instrumentation library metadata without collapsing schema scopes', () => {
  const body = fixtures().tempoTrace;
  const batch = body.batches[0];
  const scope = batch.scopeSpans[0];
  scope.instrumentationLibrary = scope.scope;
  delete scope.scope;
  batch.instrumentationLibrarySpans = batch.scopeSpans;
  delete batch.scopeSpans;
  expect(decodeTraceDetail('tempo', body, trace).spans[0].scope).toMatchObject({
    name: 'synthetic',
    version: '1.0',
  });
});
it('keeps unknown status codes unknown and does not infer errors from a message', () => {
  const body = fixtures().tempoTrace;
  body.batches[0].scopeSpans[0].spans[0].status = {
    code: 99,
    message: 'Reported provider message',
  };
  const result = decodeTraceDetail('tempo', body, trace);
  expect(result.spans[0].error).toBeNull();
  expect(result.spans[0].status?.code).toBe(99);
  expect(result.warnings).toContain('The provider reports an unknown span status code');
});
it.each([
  'status',
  'message',
  'trace-state',
  'scope',
  'scope-attributes',
  'link-attributes',
  'dropped',
])('rejects malformed or oversized auxiliary metadata %s', field => {
  const body = fixtures().tempoTrace;
  const scope = body.batches[0].scopeSpans[0];
  const span = scope.spans[1];
  if (field === 'status') span.status = false;
  if (field === 'message') span.status.message = 'x'.repeat(4097);
  if (field === 'trace-state') span.traceState = 'x'.repeat(513);
  if (field === 'scope') scope.scope = false;
  if (field === 'scope-attributes')
    scope.scope.attributes = Array(257).fill({ key: 'x', value: { boolValue: false } });
  if (field === 'link-attributes')
    span.links[0].attributes = Array(257).fill({ key: 'x', value: { boolValue: false } });
  if (field === 'dropped') span.links[0].droppedAttributesCount = 4294967296;
  expect(() => decodeTraceDetail('tempo', body, trace)).toThrow();
});
it.each(['batches', 'scopes', 'instrumentation'])(
  'rejects ambiguous %s aliases rather than silently discarding data',
  field => {
    const body = fixtures().tempoTrace;
    const batch = body.batches[0];
    const scope = batch.scopeSpans[0];
    if (field === 'batches') body.resourceSpans = body.batches;
    if (field === 'scopes') batch.instrumentationLibrarySpans = batch.scopeSpans;
    if (field === 'instrumentation') scope.instrumentationLibrary = scope.scope;
    expect(() => decodeTraceDetail('tempo', body, trace)).toThrow('Ambiguous');
  }
);
it('rejects trailing whitespace in identities and integer fields instead of normalizing a different value', () => {
  expect(() => traceId('1\n')).toThrow();
  const legacy = fixtures().jaeger;
  legacy.data[0].spans[0].parentSpanID = '0\n';
  expect(() => decodeTraceDetail('jaeger', legacy, trace)).toThrow('identity');
  const time = fixtures().tempoTrace;
  time.batches[0].scopeSpans[0].spans[0].startTimeUnixNano += '\n';
  expect(() => decodeTraceDetail('tempo', time, trace)).toThrow('Invalid');
  const integer = fixtures().tempoTrace;
  integer.batches[0].resource.attributes[1].value.intValue += '\n';
  expect(() => decodeTraceDetail('tempo', integer, trace)).toThrow('Invalid');
});
it('bounds aggregate records even when each link list stays below its individual limit', () => {
  const body = fixtures().tempoTrace;
  const scope = body.batches[0].scopeSpans[0];
  const span = scope.spans[0];
  span.attributes = [];
  span.events = [];
  span.links = Array(256).fill({
    traceId: '00000000000000000000000000000002',
    spanId: '0000000000000003',
  });
  scope.spans = Array.from({ length: 40 }, (_, index) => ({
    ...span,
    spanId: (index + 1).toString(16).padStart(16, '0'),
  }));
  expect(() => decodeTraceDetail('tempo', body, trace)).toThrow('10,000-record');
});
