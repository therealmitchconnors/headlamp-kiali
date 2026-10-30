import { TracingConfig } from './config';
import { isRecord } from './object';
import {
  tempoAttributeClauses,
  TempoAttributeFilter,
  tempoAttributeIdentifier,
} from './traceFilters';
import { tempoIntrinsicClauses, TempoIntrinsicFilter } from './traceIntrinsics';
import { TempoRelatedSpan, tempoRelatedSpanClause } from './traceRelations';

export interface TraceWindow {
  start: number;
  end: number;
}
export interface TraceQuery extends TraceWindow {
  service: string;
  operation?: string;
  limit: number;
  minDurationMs?: number;
  errorsOnly?: boolean;
  tags?: readonly TraceTagFilter[];
  tempoFilters?: readonly TempoAttributeFilter[];
  tempoIntrinsics?: readonly TempoIntrinsicFilter[];
  tempoRelatedSpan?: TempoRelatedSpan;
}
export interface TraceTagFilter {
  key: string;
  value: string;
}
export type TraceValue =
  | string
  | number
  | boolean
  | null
  | TraceValue[]
  | { [key: string]: TraceValue };
export interface TraceAttribute {
  key: string;
  value: TraceValue;
  type?: string;
}
export interface TraceReference {
  traceId: string;
  spanId: string;
  type: string;
  traceState?: string;
  flags?: TraceFlags;
  attributes?: TraceAttribute[];
  droppedAttributesCount?: number;
}
export interface TraceFlags {
  raw: number;
  sampled: boolean;
  debug?: boolean;
  firehose?: boolean;
  remote?: boolean;
}
export interface TraceScope {
  name?: string;
  version?: string;
  schemaUrl?: string;
  attributes: TraceAttribute[];
  droppedAttributesCount?: number;
}
export interface TraceStatus {
  code?: string | number;
  message?: string;
}
export interface TraceEvent {
  timestampNs: string;
  name: string;
  attributes: TraceAttribute[];
  droppedAttributesCount?: number;
}
export interface TraceSpan {
  id: string;
  traceId: string;
  parentId?: string;
  service?: string;
  operation: string;
  kind?: string;
  startNs: string;
  durationNs: string;
  error: boolean | null;
  attributes: TraceAttribute[];
  resourceAttributes: TraceAttribute[];
  events: TraceEvent[];
  references: TraceReference[];
  flags?: TraceFlags;
  traceState?: string;
  status?: TraceStatus;
  scope?: TraceScope;
  resourceSchemaUrl?: string;
  resourceDroppedAttributesCount?: number;
  droppedAttributesCount?: number;
  droppedEventsCount?: number;
  droppedLinksCount?: number;
}
export interface TraceSummary {
  id: string;
  startNs: string;
  durationNs: string;
  service?: string;
  operation?: string;
  spanCount?: number;
  matchedSpans?: number;
  errorSpans?: number;
}
export interface TraceDetail extends TraceSummary {
  spans: TraceSpan[];
  warnings: string[];
}
export interface TraceSearch {
  traces: TraceSummary[];
  warnings: string[];
}
const MAX_U64 = BigInt('18446744073709551615');
const THOUSAND = BigInt(1000);
const MILLION = BigInt(1000000);
export class TraceNotFoundError extends Error {
  readonly status = 404;
}

function text(value: unknown, field: string, optional = false): string | undefined {
  if ((value === undefined || value === null || value === '') && optional) return undefined;
  if (typeof value !== 'string' || value.length > 65536) throw new Error(`Invalid trace ${field}`);
  return value;
}
function metadataText(value: unknown, field: string, maximum = 4096): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > maximum)
    throw new Error(`Invalid or oversized trace ${field}`);
  return value;
}
const matchesWhole = (pattern: RegExp, value: string) => pattern.exec(value)?.[0] === value;
const hasValue = (value: unknown) => value !== undefined && value !== null;
function unsigned(value: unknown, field: string): bigint {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0))
    throw new Error(`Unsafe or negative trace ${field}`);
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    !matchesWhole(/^\d+$/, String(value)) ||
    String(value).length > 20
  )
    throw new Error(`Invalid trace ${field}`);
  const parsed = BigInt(value);
  if (parsed > MAX_U64) throw new Error(`Trace ${field} exceeds uint64`);
  return parsed;
}
function optionalUint32(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = unsigned(value, field);
  if (parsed > BigInt('4294967295')) throw new Error(`Trace ${field} exceeds uint32`);
  return Number(parsed);
}
export function traceFlags(
  value: unknown,
  provider: TracingConfig['provider']
): TraceFlags | undefined {
  const raw = optionalUint32(value, 'flags');
  if (raw === undefined) return undefined;
  return {
    raw,
    sampled: (raw & 1) !== 0,
    ...(provider === 'jaeger'
      ? { debug: (raw & 2) !== 0, firehose: (raw & 8) !== 0 }
      : { remote: (raw & 256) !== 0 ? (raw & 512) !== 0 : undefined }),
  };
}
function otlpStatus(value: unknown): TraceStatus | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new Error('Invalid OTLP span status');
  const code = value.code === null ? undefined : value.code;
  const message = metadataText(value.message, 'status message');
  if (code === undefined) return { message };
  if (typeof code !== 'string' && typeof code !== 'number')
    throw new Error('Invalid OTLP span status code');
  if (
    (typeof code === 'string' && code.length > 128) ||
    (typeof code === 'number' &&
      (!Number.isSafeInteger(code) || code < -2147483648 || code > 2147483647))
  )
    throw new Error('Invalid OTLP span status code');
  return { code, message };
}
function microseconds(value: unknown, field: string): string {
  const nanoseconds = unsigned(value, field) * THOUSAND;
  if (nanoseconds > MAX_U64) throw new Error(`Trace ${field} exceeds uint64 nanoseconds`);
  return nanoseconds.toString();
}
function id(value: unknown, bytes: 8 | 16, otlp = false, allowZero = false): string {
  if (typeof value !== 'string') throw new Error('Missing trace or span identity');
  let hex: string;
  if (
    matchesWhole(/^[0-9a-f]+$/i, value) &&
    (otlp ? value.length === bytes * 2 : value.length <= bytes * 2)
  )
    hex = value.toLowerCase().padStart(bytes * 2, '0');
  else if (
    otlp &&
    matchesWhole(/^[A-Za-z0-9+/]+={0,2}$/, value) &&
    value.length === (bytes === 16 ? 24 : 12)
  ) {
    let decoded: string;
    try {
      decoded = atob(value);
    } catch {
      throw new Error('Invalid OTLP identity encoding');
    }
    if (decoded.length !== bytes) throw new Error('Invalid OTLP identity length');
    hex = [...decoded]
      .map(character => character.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('');
  } else throw new Error('Invalid trace or span identity');
  if (!allowZero && /^0+$/.test(hex)) throw new Error('Zero trace or span identity');
  return hex;
}
export const traceId = (value: unknown) => id(value, 16);
export const traceMilliseconds = (nanoseconds: string) => Number(BigInt(nanoseconds)) / 1000000;
export const traceDate = (nanoseconds: string) => new Date(Number(BigInt(nanoseconds) / MILLION));

export function validTraceWindow(window: TraceWindow): boolean {
  return (
    Number.isSafeInteger(window.start) &&
    Number.isSafeInteger(window.end) &&
    window.start > 0 &&
    window.end > window.start &&
    window.end <= 8640000000000 &&
    window.end - window.start <= 86400
  );
}

export function traceSearchPath(provider: TracingConfig['provider'], query: TraceQuery): string {
  if (
    (provider !== 'jaeger' && provider !== 'tempo') ||
    !query.service.trim() ||
    query.service.length > 256 ||
    (query.operation?.length ?? 0) > 256 ||
    !validTraceWindow(query) ||
    !Number.isInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > 100 ||
    (query.minDurationMs !== undefined &&
      (!Number.isFinite(query.minDurationMs) ||
        query.minDurationMs < 0 ||
        query.minDurationMs > 86400000))
  )
    throw new Error(
      'Trace search requires a service, a positive range up to 24 hours and a limit from 1 to 100'
    );
  const filters = query.tags === undefined ? [] : query.tags;
  if (!Array.isArray(filters) || filters.length > 10)
    throw new Error('Trace search supports at most 10 exact tag filters');
  const keys = new Set<string>();
  for (const filter of filters) {
    if (
      !isRecord(filter) ||
      typeof filter.key !== 'string' ||
      typeof filter.value !== 'string' ||
      !filter.key.trim() ||
      filter.key !== filter.key.trim() ||
      filter.key.length > 256 ||
      filter.value.length > 1024 ||
      /[\u0000-\u001f\u007f]/.test(filter.key)
    )
      throw new Error(
        'Tag filters require a nonempty key up to 256 characters and a string value up to 1024 characters'
      );
    if (keys.has(filter.key)) throw new Error('Duplicate trace tag keys are not supported');
    keys.add(filter.key);
    if (filter.key === 'error' && !['true', 'false'].includes(filter.value))
      throw new Error('The error tag must be true or false');
    if (filter.key === 'error' && filter.value === 'false' && query.errorsOnly)
      throw new Error('The error=false tag conflicts with the reported-errors-only filter');
  }
  const boundedPath = (path: string) => {
    if (path.length > 16384) throw new Error('Encoded trace search exceeds 16 KiB; reduce filters');
    return path;
  };
  const attributeClauses = tempoAttributeClauses(query.tempoFilters);
  if (provider !== 'tempo' && attributeClauses.length)
    throw new Error('Typed attribute filters require Tempo; remove them before searching Jaeger');
  const intrinsicClauses = tempoIntrinsicClauses(query.tempoIntrinsics);
  if (provider !== 'tempo' && intrinsicClauses.length)
    throw new Error('Intrinsic filters require Tempo; remove them before searching Jaeger');
  const relatedSpan = tempoRelatedSpanClause(query.tempoRelatedSpan);
  if (provider !== 'tempo' && relatedSpan)
    throw new Error('Related span filters require Tempo; disable them before searching Jaeger');
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (provider === 'jaeger') {
    const start = query.start * 1000000;
    const end = query.end * 1000000;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end))
      throw new Error('Trace query timestamps exceed safe microsecond precision');
    params.set('service', query.service);
    params.set('start', String(start));
    params.set('end', String(end));
    if (query.operation) params.set('operation', query.operation);
    const tags = Object.fromEntries(filters.map(filter => [filter.key, filter.value]));
    if (query.errorsOnly) tags.error = 'true';
    if (Object.keys(tags).length) params.set('tags', JSON.stringify(tags));
    if (query.minDurationMs)
      params.set('minDuration', `${Math.round(query.minDurationMs * 1000)}us`);
    return boundedPath(`/api/traces?${params}`);
  }
  const clauses = [`.service.name = ${JSON.stringify(query.service)}`];
  if (query.operation) clauses.push(`name = ${JSON.stringify(query.operation)}`);
  if (query.errorsOnly) clauses.push('status = error');
  for (const filter of filters) {
    if (filter.key === 'error') {
      if (!query.errorsOnly)
        clauses.push(filter.value === 'true' ? 'status = error' : 'status != error');
    } else
      clauses.push(`.${tempoAttributeIdentifier(filter.key)} = ${JSON.stringify(filter.value)}`);
  }
  clauses.push(...attributeClauses);
  clauses.push(...intrinsicClauses);
  params.set('q', `{ ${clauses.join(' && ')} }${relatedSpan ? ` ${relatedSpan}` : ''}`);
  params.set('start', String(query.start));
  params.set('end', String(query.end));
  params.set('spss', '1');
  if (query.minDurationMs) params.set('minDuration', `${query.minDurationMs}ms`);
  return boundedPath(`/api/search?${params}`);
}

interface Budget {
  values: number;
  records: number;
}
function consumeRecord(budget: Budget) {
  if (++budget.records > 10000) throw new Error('Trace exceeds the 10,000-record decode budget');
}
function value(input: unknown, budget: Budget, depth = 0): TraceValue {
  if (++budget.values > 10000 || depth > 10) throw new Error('Trace attribute budget exceeded');
  if (input === null) return null;
  if (typeof input === 'boolean') return input;
  if (typeof input === 'string') {
    if (input.length > 65536) throw new Error('Trace attribute string is too long');
    return input;
  }
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (Array.isArray(input)) return input.map(entry => value(entry, budget, depth + 1));
  if (isRecord(input))
    return Object.fromEntries(
      Object.entries(input).map(([key, entry]) => [key, value(entry, budget, depth + 1)])
    );
  throw new Error('Invalid trace attribute value');
}
function list(input: unknown, limit: number, field: string): unknown[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > limit)
    throw new Error(`Invalid or oversized trace ${field}`);
  return input;
}
function jaegerAttributes(input: unknown, budget: Budget): TraceAttribute[] {
  return list(input, 256, 'attributes').map(entry => {
    if (!isRecord(entry) || typeof entry.key !== 'string' || entry.key.length > 1024)
      throw new Error('Invalid trace attribute key');
    if (
      entry.type === 'int64' &&
      typeof entry.value === 'number' &&
      !Number.isSafeInteger(entry.value)
    )
      throw new Error('Trace integer attribute exceeds exact JavaScript precision');
    return {
      key: entry.key,
      value: value(entry.value, budget),
      type: typeof entry.type === 'string' ? entry.type : undefined,
    };
  });
}
function otlpValue(input: unknown, budget: Budget, depth = 0): TraceValue {
  if (!isRecord(input) || ++budget.values > 10000 || depth > 10)
    throw new Error('Invalid or oversized OTLP attribute');
  const keys = Object.keys(input);
  if (keys.length === 0) return null;
  if (keys.length !== 1) throw new Error('OTLP attribute has multiple value variants');
  const key = keys[0];
  const entry = input[key];
  if (key === 'stringValue' || key === 'bytesValue') {
    if (typeof entry !== 'string') throw new Error('Invalid OTLP string value');
    return value(entry, budget);
  }
  if (key === 'boolValue') {
    if (typeof entry !== 'boolean') throw new Error('Invalid OTLP boolean value');
    return entry;
  }
  if (key === 'intValue') {
    if (
      (typeof entry === 'number' && !Number.isSafeInteger(entry)) ||
      (typeof entry !== 'string' && typeof entry !== 'number') ||
      !matchesWhole(/^-?\d+$/, String(entry)) ||
      String(entry).length > 20
    )
      throw new Error('Invalid OTLP integer value');
    const integer = BigInt(entry);
    if (integer < BigInt('-9223372036854775808') || integer > BigInt('9223372036854775807'))
      throw new Error('OTLP integer value exceeds int64');
    return String(entry);
  }
  if (key === 'doubleValue' && typeof entry === 'number' && Number.isFinite(entry)) return entry;
  if (key === 'arrayValue' && isRecord(entry))
    return list(entry.values, 256, 'attribute array').map(item =>
      otlpValue(item, budget, depth + 1)
    );
  if (key === 'kvlistValue' && isRecord(entry)) {
    const keys = new Set<string>();
    return Object.fromEntries(
      list(entry.values, 256, 'attribute map').map(item => {
        if (!isRecord(item) || typeof item.key !== 'string' || item.key.length > 1024)
          throw new Error('Invalid OTLP map key');
        if (keys.has(item.key)) throw new Error('Duplicate OTLP map key');
        keys.add(item.key);
        return [item.key, otlpValue(item.value, budget, depth + 1)];
      })
    );
  }
  throw new Error('Unsupported OTLP attribute value');
}
function otlpAttributes(input: unknown, budget: Budget): TraceAttribute[] {
  return list(input, 256, 'attributes').map(entry => {
    if (!isRecord(entry) || typeof entry.key !== 'string' || entry.key.length > 1024)
      throw new Error('Invalid OTLP attribute key');
    return { key: entry.key, value: otlpValue(entry.value, budget) };
  });
}
function warnings(input: unknown): string[] {
  return list(input, 100, 'warnings').map(item => {
    if (typeof item !== 'string' || item.length > 65536) throw new Error('Invalid trace warning');
    return item;
  });
}
function jaegerErrors(response: Record<string, unknown>): string[] {
  return list(response.errors, 100, 'errors').map(error => {
    if (!isRecord(error) || typeof error.msg !== 'string' || error.msg.length > 65536)
      throw new Error('Invalid tracing backend error');
    return error.msg;
  });
}
function finishTrace(trace: string, spans: TraceSpan[], notices: string[]): TraceDetail {
  if (!spans.length) throw new Error('Trace contains no spans');
  const ids = new Set<string>();
  let start = BigInt(spans[0].startNs);
  let end = start;
  for (const span of spans) {
    if (ids.has(span.id)) throw new Error('Trace contains duplicate span identities');
    ids.add(span.id);
    const begin = BigInt(span.startNs);
    const finish = begin + BigInt(span.durationNs);
    if (finish > MAX_U64) throw new Error('Trace span time exceeds uint64');
    if (begin < start) start = begin;
    if (finish > end) end = finish;
  }
  const missing = spans.filter(span => span.parentId && !ids.has(span.parentId)).length;
  if (missing)
    notices.push(`${missing} span parents are missing; trace hierarchy may be incomplete`);
  const byId = new Map(spans.map(span => [span.id, span]));
  const visited = new Set<string>();
  for (const span of spans) {
    let current: TraceSpan | undefined = span;
    const path = new Set<string>();
    while (current && !visited.has(current.id)) {
      if (path.has(current.id)) {
        notices.push(
          'Trace contains a parent cycle; spans are displayed without inferring a hierarchy'
        );
        break;
      }
      path.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    for (const node of path) visited.add(node);
  }
  const roots = spans.filter(span => !span.parentId);
  const root = roots.length === 1 ? roots[0] : undefined;
  if (roots.length !== 1) notices.push('A unique trace root was not reported');
  return {
    id: trace,
    startNs: start.toString(),
    durationNs: (end - start).toString(),
    service: root?.service,
    operation: root?.operation,
    spanCount: spans.length,
    errorSpans: spans.filter(span => span.error === true).length,
    spans: [...spans].sort((a, b) =>
      BigInt(a.startNs) < BigInt(b.startNs)
        ? -1
        : BigInt(a.startNs) > BigInt(b.startNs)
        ? 1
        : a.id.localeCompare(b.id)
    ),
    warnings: [...new Set(notices)],
  };
}
function jaegerTrace(input: unknown): TraceDetail {
  if (!isRecord(input)) throw new Error('Invalid Jaeger trace');
  const trace = traceId(input.traceID);
  const budget = { values: 0, records: 0 };
  const notices = warnings(input.warnings);
  if (!isRecord(input.processes ?? {})) throw new Error('Invalid Jaeger processes');
  const processes = isRecord(input.processes) ? input.processes : {};
  const spans = list(input.spans, 2000, 'spans').map((entry): TraceSpan => {
    consumeRecord(budget);
    if (!isRecord(entry)) throw new Error('Invalid Jaeger span');
    if (entry.traceID !== undefined && traceId(entry.traceID) !== trace)
      throw new Error('Span belongs to a different trace');
    const spanId = id(entry.spanID, 8);
    const references = list(entry.references, 256, 'references').map(reference => {
      consumeRecord(budget);
      if (!isRecord(reference) || typeof reference.refType !== 'string')
        throw new Error('Invalid span reference');
      return {
        traceId: reference.traceID === undefined ? trace : traceId(reference.traceID),
        spanId: id(reference.spanID, 8),
        type: reference.refType,
      };
    });
    const parents = references.filter(
      reference => reference.type === 'CHILD_OF' && reference.traceId === trace
    );
    const legacyParent =
      entry.parentSpanID === undefined || entry.parentSpanID === null || entry.parentSpanID === ''
        ? undefined
        : id(entry.parentSpanID, 8, false, true);
    let parentId = parents.length === 1 ? parents[0].spanId : undefined;
    if (!parents.length && legacyParent && !/^0+$/.test(legacyParent)) parentId = legacyParent;
    if (parents.length > 1)
      notices.push(`Span ${spanId} has multiple parents; no parent was selected`);
    const process = isRecord(entry.process)
      ? entry.process
      : typeof entry.processID === 'string' &&
        Object.prototype.hasOwnProperty.call(processes, entry.processID)
      ? processes[entry.processID]
      : undefined;
    if (process !== undefined && !isRecord(process)) throw new Error('Invalid span process');
    const attributes = jaegerAttributes(entry.tags, budget);
    const errors = attributes
      .filter(attribute => attribute.key === 'error')
      .map(attribute => attribute.value);
    notices.push(...warnings(entry.warnings));
    return {
      id: spanId,
      traceId: trace,
      parentId,
      service: isRecord(process) ? text(process.serviceName, 'service name', true) : undefined,
      operation: text(entry.operationName, 'operation')!,
      startNs: microseconds(entry.startTime, 'start time'),
      durationNs: microseconds(entry.duration, 'duration'),
      error: errors.includes(true) ? true : errors.includes(false) ? false : null,
      attributes,
      resourceAttributes: isRecord(process) ? jaegerAttributes(process.tags, budget) : [],
      events: list(entry.logs, 256, 'events').map(log => {
        consumeRecord(budget);
        if (!isRecord(log)) throw new Error('Invalid span log');
        return {
          timestampNs: microseconds(log.timestamp, 'event time'),
          name: 'Log',
          attributes: jaegerAttributes(log.fields, budget),
        };
      }),
      references,
      flags: traceFlags(entry.flags, 'jaeger'),
    };
  });
  return finishTrace(trace, spans, notices);
}

export function decodeTraceSearch(
  provider: TracingConfig['provider'],
  input: unknown,
  limit: number
): TraceSearch {
  if (!isRecord(input)) throw new Error('Invalid tracing search response');
  const traces: TraceSummary[] = [];
  const notices = provider === 'jaeger' ? jaegerErrors(input) : [];
  const entries = provider === 'jaeger' ? input.data : input.traces;
  if (!Array.isArray(entries) || entries.length > limit || entries.length > 100)
    throw new Error('Trace search response is malformed or exceeds the requested limit');
  if (!entries.length && notices.length) throw new Error(notices.join('; '));
  let spanCount = 0;
  for (const entry of entries) {
    if (provider === 'jaeger') {
      const detail = jaegerTrace(entry);
      const { spans, warnings: traceWarnings, ...summary } = detail;
      spanCount += spans.length;
      if (spanCount > 10000) throw new Error('Trace search exceeds the 10,000-span decode limit');
      notices.push(...traceWarnings);
      traces.push(summary);
    } else {
      if (
        !isRecord(entry) ||
        typeof entry.durationMs !== 'number' ||
        !Number.isFinite(entry.durationMs) ||
        entry.durationMs < 0 ||
        !Number.isSafeInteger(entry.durationMs * 1000000)
      )
        throw new Error('Invalid Tempo trace summary');
      const sets = Array.isArray(entry.spanSets)
        ? entry.spanSets
        : entry.spanSet === undefined
        ? []
        : [entry.spanSet];
      const matched = sets.length === 1 && isRecord(sets[0]) ? sets[0].matched : undefined;
      const start = unsigned(entry.startTimeUnixNano, 'start time');
      const duration = BigInt(entry.durationMs * 1000000);
      if (start + duration > MAX_U64) throw new Error('Trace summary time exceeds uint64');
      traces.push({
        id: traceId(entry.traceID),
        startNs: start.toString(),
        durationNs: duration.toString(),
        service: text(entry.rootServiceName, 'root service', true),
        operation: text(entry.rootTraceName, 'root operation', true),
        matchedSpans:
          typeof matched === 'number' && Number.isSafeInteger(matched) && matched >= 0
            ? matched
            : undefined,
      });
    }
  }
  if (new Set(traces.map(trace => trace.id)).size !== traces.length)
    throw new Error('Duplicate trace search identities');
  if (traces.length === limit)
    notices.push('The result limit was reached; additional traces may exist');
  return { traces, warnings: [...new Set(notices)] };
}

export function decodeTraceDetail(
  provider: TracingConfig['provider'],
  input: unknown,
  expectedId: string
): TraceDetail {
  const expected = traceId(expectedId);
  if (!isRecord(input)) throw new Error('Invalid trace detail response');
  if (provider === 'jaeger') {
    const notices = jaegerErrors(input);
    if (Array.isArray(input.data) && input.data.length === 0 && !notices.length)
      throw new TraceNotFoundError('Trace was not found');
    if (!Array.isArray(input.data) || input.data.length !== 1)
      throw new Error(notices[0] ?? 'Trace was not found or multiple traces were returned');
    const result = jaegerTrace(input.data[0]);
    if (result.id !== expected) throw new Error('Trace response does not match the requested ID');
    return { ...result, warnings: [...result.warnings, ...notices] };
  }
  if (hasValue(input.batches) && hasValue(input.resourceSpans))
    throw new Error('Ambiguous Tempo resource batch aliases');
  const batches = input.batches ?? input.resourceSpans;
  if (!Array.isArray(batches) || batches.length > 2000)
    throw new Error('Invalid Tempo resource batches');
  const spans: TraceSpan[] = [];
  const notices: string[] = [];
  const budget = { values: 0, records: 0 };
  for (const batch of batches) {
    consumeRecord(budget);
    if (!isRecord(batch) || !isRecord(batch.resource ?? {}))
      throw new Error('Invalid OTLP resource');
    const resource = isRecord(batch.resource) ? batch.resource : {};
    const resourceAttributes = otlpAttributes(resource.attributes, budget);
    const resourceSchemaUrl = metadataText(batch.schemaUrl, 'resource schema URL', 2048);
    const resourceDroppedAttributesCount = optionalUint32(
      resource.droppedAttributesCount,
      'dropped resource attributes'
    );
    const services = new Set(
      resourceAttributes
        .filter(
          attribute => attribute.key === 'service.name' && typeof attribute.value === 'string'
        )
        .map(attribute => String(attribute.value))
    );
    if (services.size > 1) notices.push('A resource reports conflicting service names');
    const serviceValue = services.size === 1 ? [...services][0] : undefined;
    if (resourceDroppedAttributesCount !== undefined && resourceDroppedAttributesCount > 0)
      notices.push('The provider reports dropped resource attributes');
    if (hasValue(batch.scopeSpans) && hasValue(batch.instrumentationLibrarySpans))
      throw new Error('Ambiguous OTLP scope collection aliases');
    for (const scope of list(
      batch.scopeSpans ?? batch.instrumentationLibrarySpans,
      2000,
      'scope spans'
    )) {
      if (!isRecord(scope)) throw new Error('Invalid OTLP scope');
      consumeRecord(budget);
      if (hasValue(scope.scope) && hasValue(scope.instrumentationLibrary))
        throw new Error('Ambiguous OTLP instrumentation scope aliases');
      const sourceScope = scope.scope ?? scope.instrumentationLibrary;
      const schemaUrl = metadataText(scope.schemaUrl, 'scope schema URL', 2048);
      let instrumentation: TraceScope | undefined;
      if (sourceScope !== undefined && sourceScope !== null && !isRecord(sourceScope))
        throw new Error('Invalid OTLP instrumentation scope');
      if (hasValue(sourceScope) || schemaUrl !== undefined) {
        const fields = isRecord(sourceScope) ? sourceScope : {};
        instrumentation = {
          name: metadataText(fields.name, 'scope name', 1024),
          version: metadataText(fields.version, 'scope version', 1024),
          schemaUrl,
          attributes: otlpAttributes(fields.attributes, budget),
          droppedAttributesCount: optionalUint32(
            fields.droppedAttributesCount,
            'dropped scope attributes'
          ),
        };
        if (
          instrumentation.droppedAttributesCount !== undefined &&
          instrumentation.droppedAttributesCount > 0
        )
          notices.push('The provider reports dropped scope attributes');
      }
      for (const entry of list(scope.spans, 2000, 'spans')) {
        consumeRecord(budget);
        if (spans.length >= 2000) throw new Error('Trace exceeds the 2,000-span limit');
        if (!isRecord(entry) || id(entry.traceId, 16, true) !== expected)
          throw new Error('OTLP span belongs to a different trace');
        const start = unsigned(entry.startTimeUnixNano, 'start time');
        const end = unsigned(entry.endTimeUnixNano, 'end time');
        if (end < start) throw new Error('Span ends before it starts');
        if (entry.parentSpanId !== undefined && typeof entry.parentSpanId !== 'string')
          throw new Error('Invalid OTLP parent span identity');
        const parent =
          typeof entry.parentSpanId === 'string' && entry.parentSpanId
            ? id(entry.parentSpanId, 8, true, true)
            : undefined;
        const spanStatus = otlpStatus(entry.status);
        const status = spanStatus?.code;
        if (
          status !== undefined &&
          ![0, 1, 2, 'STATUS_CODE_UNSET', 'STATUS_CODE_OK', 'STATUS_CODE_ERROR'].includes(status)
        )
          notices.push('The provider reports an unknown span status code');
        const attributes = otlpAttributes(entry.attributes, budget);
        const reportedError = attributes.some(
          attribute =>
            (attribute.key === 'error' && attribute.value === true) ||
            (attribute.key === 'status' && attribute.value === 'error')
        );
        const droppedAttributesCount = optionalUint32(
          entry.droppedAttributesCount,
          'dropped span attributes'
        );
        const droppedEventsCount = optionalUint32(entry.droppedEventsCount, 'dropped span events');
        const droppedLinksCount = optionalUint32(entry.droppedLinksCount, 'dropped span links');
        if (
          [droppedAttributesCount, droppedEventsCount, droppedLinksCount].some(
            count => count !== undefined && count > 0
          )
        )
          notices.push('The provider reports dropped span data');
        spans.push({
          id: id(entry.spanId, 8, true),
          traceId: expected,
          parentId: parent && !/^0+$/.test(parent) ? parent : undefined,
          service: typeof serviceValue === 'string' ? serviceValue : undefined,
          operation: text(entry.name, 'operation')!,
          kind:
            typeof entry.kind === 'string' || typeof entry.kind === 'number'
              ? String(entry.kind)
              : undefined,
          startNs: start.toString(),
          durationNs: (end - start).toString(),
          error:
            reportedError || status === 2 || status === 'STATUS_CODE_ERROR'
              ? true
              : status === 1 || status === 'STATUS_CODE_OK'
              ? false
              : null,
          attributes,
          resourceAttributes,
          flags: traceFlags(entry.flags, 'tempo'),
          traceState: metadataText(entry.traceState, 'trace state', 512),
          status: spanStatus,
          scope: instrumentation,
          resourceSchemaUrl,
          resourceDroppedAttributesCount,
          droppedAttributesCount,
          droppedEventsCount,
          droppedLinksCount,
          events: list(entry.events, 256, 'events').map(event => {
            consumeRecord(budget);
            if (!isRecord(event)) throw new Error('Invalid OTLP event');
            const dropped = optionalUint32(
              event.droppedAttributesCount,
              'dropped event attributes'
            );
            if (dropped !== undefined && dropped > 0)
              notices.push('The provider reports dropped event attributes');
            return {
              timestampNs: unsigned(event.timeUnixNano, 'event time').toString(),
              name: text(event.name, 'event name')!,
              attributes: otlpAttributes(event.attributes, budget),
              droppedAttributesCount: dropped,
            };
          }),
          references: list(entry.links, 256, 'links').map(link => {
            consumeRecord(budget);
            if (!isRecord(link)) throw new Error('Invalid OTLP span link');
            const dropped = optionalUint32(link.droppedAttributesCount, 'dropped link attributes');
            if (dropped !== undefined && dropped > 0)
              notices.push('The provider reports dropped link attributes');
            return {
              traceId: id(link.traceId, 16, true),
              spanId: id(link.spanId, 8, true),
              type: 'LINK',
              flags: traceFlags(link.flags, 'tempo'),
              traceState: metadataText(link.traceState, 'link trace state', 512),
              attributes: otlpAttributes(link.attributes, budget),
              droppedAttributesCount: dropped,
            };
          }),
        });
      }
    }
  }
  return finishTrace(expected, spans, notices);
}
