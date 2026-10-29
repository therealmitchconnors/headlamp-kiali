import { editableObject, isRecord } from './object';

type EditMode = 'keep' | 'set' | 'remove';
export interface CircuitBreakerDraft {
  connectionPoolMode: EditMode;
  maxConnections: string;
  http1MaxPendingRequests: string;
  outlierMode: EditMode;
  consecutive5xxErrors: string;
}
export interface CircuitBreakerChanges {
  connectionPool?: null | {
    tcp: { maxConnections: number };
    http: { http1MaxPendingRequests: number };
  };
  outlierDetection?: null | { consecutive5xxErrors: number };
}

export function initialCircuitBreaker(spec?: unknown): CircuitBreakerDraft {
  const policy = isRecord(spec) && isRecord(spec.trafficPolicy) ? spec.trafficPolicy : {};
  const pool = isRecord(policy.connectionPool) ? policy.connectionPool : {};
  const tcp = isRecord(pool.tcp) ? pool.tcp : {};
  const http = isRecord(pool.http) ? pool.http : {};
  const outlier = isRecord(policy.outlierDetection) ? policy.outlierDetection : {};
  const text = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? String(value) : '1';
  return {
    connectionPoolMode: 'keep',
    maxConnections: text(tcp.maxConnections),
    http1MaxPendingRequests: text(http.http1MaxPendingRequests),
    outlierMode: 'keep',
    consecutive5xxErrors: text(outlier.consecutive5xxErrors ?? outlier.consecutiveErrors),
  };
}

function count(value: string, maximum: number, field: string) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > 10 || /^\d+$/.exec(text)?.[0] !== text)
    throw new Error(`${field} must be a whole number between 0 and ${maximum}`);
  const result = Number(text);
  if (!Number.isSafeInteger(result) || result < 0 || result > maximum)
    throw new Error(`${field} must be a whole number between 0 and ${maximum}`);
  return result;
}

export function circuitBreakerChanges(draft: CircuitBreakerDraft): CircuitBreakerChanges {
  if (
    ![draft.connectionPoolMode, draft.outlierMode].every(mode =>
      ['keep', 'set', 'remove'].includes(mode)
    )
  )
    throw new Error('Unknown circuit-breaker edit action');
  const changes: CircuitBreakerChanges = {};
  if (draft.connectionPoolMode === 'set')
    changes.connectionPool = {
      tcp: { maxConnections: count(draft.maxConnections, 2147483647, 'Maximum connections') },
      http: {
        http1MaxPendingRequests: count(
          draft.http1MaxPendingRequests,
          2147483647,
          'HTTP/1 pending requests'
        ),
      },
    };
  else if (draft.connectionPoolMode === 'remove') changes.connectionPool = null;
  if (draft.outlierMode === 'set')
    changes.outlierDetection = {
      consecutive5xxErrors: count(draft.consecutive5xxErrors, 4294967295, 'Consecutive 5xx errors'),
    };
  else if (draft.outlierMode === 'remove') changes.outlierDetection = null;
  return changes;
}

export function planCircuitBreaker(
  spec: unknown,
  draft: CircuitBreakerDraft
): { spec: Record<string, unknown> } {
  if (!isRecord(spec) || typeof spec.host !== 'string' || !spec.host || spec.host.length > 1024)
    throw new Error('Circuit-breaker editing requires an existing DestinationRule host');
  const changes = circuitBreakerChanges(draft);
  if (!Object.keys(changes).length)
    throw new Error('Choose a circuit-breaker setting to set or remove');
  const original = editableObject(spec.trafficPolicy, 'traffic policy');
  const policy = { ...original };
  if (changes.connectionPool === null) delete policy.connectionPool;
  else if (changes.connectionPool) {
    const pool = editableObject(policy.connectionPool, 'connection pool');
    pool.tcp = {
      ...editableObject(pool.tcp, 'TCP connection pool'),
      ...changes.connectionPool.tcp,
    };
    pool.http = {
      ...editableObject(pool.http, 'HTTP connection pool'),
      ...changes.connectionPool.http,
    };
    policy.connectionPool = pool;
  }
  if (changes.outlierDetection === null) delete policy.outlierDetection;
  else if (changes.outlierDetection) {
    const outlier: Record<string, unknown> = {
      ...editableObject(policy.outlierDetection, 'outlier detection'),
      ...changes.outlierDetection,
    };
    delete outlier.consecutiveErrors;
    policy.outlierDetection = outlier;
  }
  if (JSON.stringify(original) === JSON.stringify(policy))
    throw new Error('The circuit-breaker settings would not change');
  const next = { ...spec };
  if (Object.keys(policy).length) next.trafficPolicy = policy;
  else delete next.trafficPolicy;
  return { spec: next };
}
