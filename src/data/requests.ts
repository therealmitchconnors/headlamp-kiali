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

export async function readCluster(
  scope: ClusterScope,
  path: string,
  signal: AbortSignal
): Promise<unknown> {
  if (!scope.cluster.trim() || !path.startsWith('/') || path.startsWith('//')) {
    throw new Error('A cluster and an absolute API path are required');
  }
  signal.throwIfAborted();
  return ApiProxy.request(
    path,
    { cluster: scope.cluster, signal, autoLogoutOnAuthError: false },
    false
  );
}

export function serviceProxyPath(endpoint: ServiceEndpoint, suffix: string): string {
  const checked = validateServiceEndpoint(endpoint);
  if (!/^\/[a-zA-Z0-9/_-]+$/.test(suffix)) {
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
