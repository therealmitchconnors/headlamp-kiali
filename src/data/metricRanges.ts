import { ServiceEndpoint, validateServiceEndpoint } from '../core/config';
import { MetricTimeRange, validateMetricTimeRange } from '../core/metricRanges';
import { isRecord } from '../core/object';
import { ClusterScope, clusterScope } from '../core/scope';
import { MetricResult } from '../core/telemetry';
import {
  InvalidResponseError,
  readCluster,
  readFailure,
  serviceProxyPath,
  withDiagnosticDeadline,
} from './requests';
import type { MetricRead } from './telemetry';

export async function loadMetricRanges<Query extends MetricTimeRange, Key extends string>(
  scope: ClusterScope,
  endpoint: ServiceEndpoint,
  query: Query,
  jobs: readonly { key: Key; expression: string }[],
  signal: AbortSignal,
  decode: (response: unknown, query: Query, key: Key) => MetricResult,
  timeoutMessage: string
) {
  signal.throwIfAborted();
  const captured = structuredClone(query);
  validateMetricTimeRange(captured);
  if (
    !Array.isArray(jobs) ||
    !jobs.length ||
    jobs.length > 8 ||
    jobs.some(
      job =>
        !isRecord(job) ||
        typeof job.key !== 'string' ||
        !job.key ||
        typeof job.expression !== 'string' ||
        !job.expression ||
        job.expression.length > 16384
    ) ||
    new Set(jobs.map(job => job.key)).size !== jobs.length
  )
    throw new Error('Range reads require 1 to 8 distinct bounded metric queries');
  const queries = jobs.map(job => ({ ...job }));
  const capturedScope = clusterScope(scope.cluster);
  const path = serviceProxyPath(validateServiceEndpoint(endpoint), '/api/v1/query_range');
  return withDiagnosticDeadline(signal, timeoutMessage, async requestSignal => {
    const metrics: { key: Key; read: MetricRead }[] = new Array(queries.length);
    let next = 0;
    async function worker() {
      while (next < queries.length) {
        requestSignal.throwIfAborted();
        const index = next++;
        const item = queries[index];
        let read: MetricRead;
        try {
          const params = new URLSearchParams({
            query: item.expression,
            start: String(captured.end - captured.minutes * 60),
            end: String(captured.end),
            step: '15',
          });
          const response = await readCluster(capturedScope, `${path}?${params}`, requestSignal);
          requestSignal.throwIfAborted();
          try {
            read = { ok: true, result: decode(response, captured, item.key) };
          } catch (error) {
            throw new InvalidResponseError(
              error instanceof Error ? error.message : 'Invalid aggregated metric response'
            );
          }
        } catch (error) {
          if (requestSignal.aborted) throw error;
          read = { ok: false, error: readFailure(error) };
        }
        metrics[index] = { key: item.key, read };
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, queries.length) }, worker));
    return { query: captured, metrics };
  });
}
