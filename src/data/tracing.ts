import { TracingConfig, validateTracingConfig } from '../core/config';
import { isRecord } from '../core/object';
import { ClusterScope, clusterScope } from '../core/scope';
import { decodeTraceNames, TraceNameQuery, traceNamesPath } from '../core/traceNames';
import {
  decodeTraceDetail,
  decodeTraceSearch,
  traceId,
  TraceNotFoundError,
  TraceQuery,
  traceSearchPath,
} from '../core/tracing';
import {
  InvalidResponseError,
  readCluster,
  serviceProxyPath,
  withDiagnosticDeadline,
} from './requests';

async function request(
  scope: ClusterScope,
  config: TracingConfig,
  suffix: string,
  signal: AbortSignal
) {
  const checked = validateTracingConfig(config);
  const index = suffix.indexOf('?');
  const path = index < 0 ? suffix : suffix.slice(0, index);
  const query = index < 0 ? '' : suffix.slice(index);
  return readCluster(scope, serviceProxyPath(checked.endpoint, path) + query, signal, {
    Accept: 'application/json',
  });
}
function decode<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof TraceNotFoundError) throw error;
    throw new InvalidResponseError(
      error instanceof Error ? error.message : 'Invalid tracing response'
    );
  }
}
export async function inspectTracing(
  scope: ClusterScope,
  config: TracingConfig,
  signal: AbortSignal
): Promise<{ count: number }> {
  const checked = validateTracingConfig(config);
  const capturedScope = clusterScope(scope.cluster);
  const provider = checked.provider;
  return withDiagnosticDeadline(
    signal,
    'The tracing connection check exceeded 15 seconds',
    async requestSignal => {
      const result = await request(
        capturedScope,
        checked,
        provider === 'jaeger' ? '/api/services' : '/api/search/tags',
        requestSignal
      );
      return decode(() => {
        if (!isRecord(result)) throw new Error('Invalid tracing capability response');
        if (Array.isArray(result.errors) && result.errors.length)
          throw new Error('Tracing backend reported capability errors');
        const entries = provider === 'jaeger' ? result.data : result.tagNames;
        if (
          !Array.isArray(entries) ||
          entries.length > 10000 ||
          entries.some(entry => typeof entry !== 'string')
        )
          throw new Error('Invalid tracing capability list');
        return { count: entries.length };
      });
    }
  );
}
export async function searchTraces(
  scope: ClusterScope,
  config: TracingConfig,
  query: TraceQuery,
  signal: AbortSignal
) {
  const checked = validateTracingConfig(config);
  const capturedScope = clusterScope(scope.cluster);
  const path = traceSearchPath(checked.provider, query);
  const provider = checked.provider;
  const limit = query.limit;
  return withDiagnosticDeadline(
    signal,
    'The trace search exceeded 15 seconds',
    async requestSignal => {
      const result = await request(capturedScope, checked, path, requestSignal);
      return decode(() => decodeTraceSearch(provider, result, limit));
    }
  );
}
export async function loadTrace(
  scope: ClusterScope,
  config: TracingConfig,
  id: string,
  signal: AbortSignal
) {
  const expected = traceId(id);
  const checked = validateTracingConfig(config);
  const capturedScope = clusterScope(scope.cluster);
  const provider = checked.provider;
  return withDiagnosticDeadline(
    signal,
    'The trace detail read exceeded 15 seconds',
    async requestSignal => {
      const result = await request(
        capturedScope,
        checked,
        `/api/traces/${expected}`,
        requestSignal
      );
      return decode(() => decodeTraceDetail(provider, result, expected));
    }
  );
}

export async function discoverTraceNames(
  scope: ClusterScope,
  config: TracingConfig,
  query: TraceNameQuery,
  signal: AbortSignal
) {
  const checked = validateTracingConfig(config);
  const capturedScope = clusterScope(scope.cluster);
  const path = traceNamesPath(checked.provider, query);
  const kind = query.kind;
  return withDiagnosticDeadline(
    signal,
    'Trace name discovery exceeded 15 seconds',
    async requestSignal => {
      const response = await request(capturedScope, checked, path, requestSignal);
      return decode(() => decodeTraceNames(checked.provider, kind, response));
    }
  );
}
