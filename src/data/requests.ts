import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { ServiceEndpoint, validateServiceEndpoint } from '../core/config';
import { isRecord } from '../core/object';
import { ClusterScope } from '../core/scope';

export type FailureKind =
  | 'not-found'
  | 'forbidden'
  | 'unauthenticated'
  | 'unavailable'
  | 'invalid-response';

export interface ReadFailure {
  kind: FailureKind;
  message: string;
  status?: number;
}

export class InvalidResponseError extends Error {}

export function observedResourceIdentity(
  value: unknown,
  expected: { kind: string; apiVersion: string; namespace: string; name: string }
) {
  if (
    !isRecord(value) ||
    value.kind !== expected.kind ||
    value.apiVersion !== expected.apiVersion ||
    !isRecord(value.metadata) ||
    value.metadata.name !== expected.name ||
    value.metadata.namespace !== expected.namespace
  )
    throw new InvalidResponseError(
      `${expected.kind} response does not match the requested identity and scope`
    );
  const metadata = value.metadata;
  const text = (field: 'uid' | 'resourceVersion') => {
    const result = metadata[field];
    if (typeof result !== 'string' || !result || result.length > 1024 || result.trim() !== result)
      throw new InvalidResponseError(`${expected.kind} ${field} is missing or malformed`);
    return result;
  };
  return { uid: text('uid'), resourceVersion: text('resourceVersion') };
}

export function readFailure(error: unknown): ReadFailure {
  const status = isRecord(error) && typeof error.status === 'number' ? error.status : undefined;
  const message =
    error instanceof Error
      ? error.message
      : isRecord(error) && typeof error.message === 'string'
      ? error.message
      : 'The request failed without an error message';
  const kind: FailureKind =
    error instanceof InvalidResponseError
      ? 'invalid-response'
      : status === 404
      ? 'not-found'
      : status === 403
      ? 'forbidden'
      : status === 401
      ? 'unauthenticated'
      : 'unavailable';
  return { kind, message, status };
}

export async function withDiagnosticDeadline<T>(
  signal: AbortSignal,
  timeoutMessage: string,
  read: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  let cancel: () => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(new DOMException('Diagnostic read cancelled', 'AbortError'));
    controller.signal.addEventListener('abort', cancel, { once: true });
  });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 15000);
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return read(controller.signal);
      }),
      cancelled,
    ]);
    controller.signal.throwIfAborted();
    return result;
  } catch (error) {
    if (!signal.aborted && timedOut) throw new Error(timeoutMessage);
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', cancel);
    controller.abort();
  }
}

export async function readCluster(
  scope: ClusterScope,
  path: string,
  signal: AbortSignal,
  headers?: Readonly<Record<string, string>>
): Promise<unknown> {
  if (!scope.cluster.trim() || !path.startsWith('/') || path.startsWith('//')) {
    throw new Error('A cluster and an absolute API path are required');
  }
  signal.throwIfAborted();
  return ApiProxy.request(
    path,
    {
      cluster: scope.cluster,
      signal,
      autoLogoutOnAuthError: false,
      ...(headers ? { headers } : {}),
    },
    false
  );
}

export async function readClusterText(
  scope: ClusterScope,
  path: string,
  signal: AbortSignal,
  maxBytes: number
): Promise<{ text: string; limited: boolean; bytes: number }> {
  if (
    !scope.cluster.trim() ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 1048576
  )
    throw new Error('A cluster, absolute API path and bounded text size are required');
  signal.throwIfAborted();
  const response: unknown = await ApiProxy.request(
    path,
    {
      cluster: scope.cluster,
      signal,
      autoLogoutOnAuthError: false,
      isJSON: false,
      cache: 'no-store',
      // Kubernetes negotiates its API serializer before returning the plaintext log stream.
      headers: { Accept: '*/*' },
    },
    false
  );
  signal.throwIfAborted();
  if (!(response instanceof Response))
    throw new InvalidResponseError('The host did not return a raw text response');
  if (!response.ok)
    throw Object.assign(new Error('The diagnostic text request failed'), {
      status: response.status,
    });
  if (!response.body) return { text: '', limited: false, bytes: 0 };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  let limited = false;
  const cancel = () => {
    void reader.cancel().catch(() => console.warn('Unable to cancel a diagnostic text stream'));
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const result = await reader.read();
      if (result.done) break;
      const remaining = maxBytes - bytes;
      const chunk = result.value.subarray(0, remaining);
      bytes += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
      if (result.value.byteLength >= remaining) {
        limited = true;
        await reader.cancel();
        break;
      }
    }
    signal.throwIfAborted();
    text += decoder.decode();
    return { text, bytes, limited };
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

export function serviceProxyPath(endpoint: ServiceEndpoint, suffix: string): string {
  const checked = validateServiceEndpoint(endpoint);
  if (
    /^\/[a-zA-Z0-9/_.-]+$/.exec(suffix)?.[0] !== suffix ||
    suffix.split('/').some(segment => segment === '.' || segment === '..')
  ) {
    throw new Error('Service API suffix must be a plain absolute path');
  }
  return (
    `/api/v1/namespaces/${encodeURIComponent(checked.namespace)}/services/` +
    `${encodeURIComponent(checked.service)}:${encodeURIComponent(checked.port)}/proxy` +
    checked.basePath +
    suffix
  );
}

export async function discoverIstio(
  scope: ClusterScope,
  signal: AbortSignal
): Promise<{ versions: string[] }> {
  const response = await readCluster(scope, '/apis/networking.istio.io', signal);
  if (
    !isRecord(response) ||
    response.name !== 'networking.istio.io' ||
    !Array.isArray(response.versions) ||
    response.versions.length === 0
  ) {
    throw new InvalidResponseError('Istio API discovery returned an invalid API group');
  }
  const versions = response.versions.map((version: unknown) => {
    if (!isRecord(version) || typeof version.version !== 'string' || !version.version) {
      throw new InvalidResponseError('Istio API discovery returned an invalid version');
    }
    return version.version;
  });
  return { versions };
}

export async function inspectPrometheus(
  scope: ClusterScope,
  endpoint: ServiceEndpoint,
  signal: AbortSignal
): Promise<{ version: string }> {
  const response = await readCluster(
    scope,
    serviceProxyPath(endpoint, '/api/v1/status/buildinfo'),
    signal
  );
  if (
    !isRecord(response) ||
    response.status !== 'success' ||
    !isRecord(response.data) ||
    typeof response.data.version !== 'string' ||
    !response.data.version
  ) {
    throw new InvalidResponseError('Prometheus returned an invalid build information response');
  }
  return { version: response.data.version };
}
