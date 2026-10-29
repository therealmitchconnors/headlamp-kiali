import { isRecord } from '../core/object';
import { ClusterScope } from '../core/scope';
import { InvalidResponseError, readCluster, ReadFailure, readFailure } from './requests';

export interface CollectionRequest {
  path: string;
  kind: string;
  apiVersion: string;
  query?: Record<string, string>;
  pageSize?: number;
}
export interface CollectionRead<T> {
  items: T[];
  complete: boolean;
  resourceVersion?: string;
  error?: ReadFailure;
  limited?: boolean;
}

export async function readCollection<T>(
  scope: ClusterScope,
  request: CollectionRequest,
  decode: (value: Record<string, unknown>) => T,
  signal: AbortSignal
): Promise<CollectionRead<T>> {
  const items: T[] = [];
  let resourceVersion: string | undefined;
  try {
    const pageSize = request.pageSize ?? 250;
    if (
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 250 ||
      request.query?.limit !== undefined ||
      request.query?.continue !== undefined
    )
      throw new Error('Invalid bounded collection request');
    let token = '';
    const tokens = new Set<string>();
    const names = new Set<string>();
    const uids = new Set<string>();
    for (let page = 0; page < 4; page++) {
      const params = new URLSearchParams({ ...request.query, limit: String(pageSize) });
      if (token) params.set('continue', token);
      const response = await readCluster(scope, `${request.path}?${params}`, signal);
      if (
        !isRecord(response) ||
        response.kind !== `${request.kind}List` ||
        response.apiVersion !== request.apiVersion ||
        !Array.isArray(response.items) ||
        response.items.length > pageSize ||
        !isRecord(response.metadata) ||
        typeof response.metadata.resourceVersion !== 'string' ||
        !response.metadata.resourceVersion
      )
        throw new InvalidResponseError(`Invalid ${request.kind} list response`);
      if (resourceVersion !== undefined && resourceVersion !== response.metadata.resourceVersion)
        throw new InvalidResponseError('Resource version changed during pagination');
      resourceVersion = response.metadata.resourceVersion;
      const next = response.metadata.continue ?? '';
      if (typeof next !== 'string' || (next && tokens.has(next)))
        throw new InvalidResponseError('Invalid or repeated continuation token');
      const remaining = response.metadata.remainingItemCount;
      if (
        remaining !== undefined &&
        (typeof remaining !== 'number' ||
          !Number.isInteger(remaining) ||
          remaining < 0 ||
          (!next && remaining > 0))
      )
        throw new InvalidResponseError('Invalid remaining-item count or missing continuation');
      const decoded = response.items.map((item: unknown) => {
        if (
          !isRecord(item) ||
          !isRecord(item.metadata) ||
          (item.kind !== undefined && item.kind !== request.kind) ||
          (item.apiVersion !== undefined && item.apiVersion !== request.apiVersion) ||
          typeof item.metadata.name !== 'string' ||
          !item.metadata.name ||
          typeof item.metadata.uid !== 'string' ||
          !item.metadata.uid ||
          (item.metadata.namespace !== undefined && typeof item.metadata.namespace !== 'string')
        )
          throw new InvalidResponseError(`Malformed ${request.kind} list item`);
        const name = JSON.stringify([item.metadata.namespace ?? '', item.metadata.name]);
        if (names.has(name) || uids.has(item.metadata.uid))
          throw new InvalidResponseError('Duplicate collection resource');
        names.add(name);
        uids.add(item.metadata.uid);
        try {
          return decode({ ...item, kind: request.kind, apiVersion: request.apiVersion });
        } catch (error) {
          if (error instanceof InvalidResponseError) throw error;
          throw new InvalidResponseError(
            error instanceof Error ? error.message : 'Invalid collection item'
          );
        }
      });
      items.push(...decoded);
      if (!next) return { items, resourceVersion, complete: true };
      tokens.add(next);
      token = next;
    }
    return { items, resourceVersion, complete: false, limited: true };
  } catch (error) {
    if (signal.aborted) throw error;
    return { items, resourceVersion, complete: false, error: readFailure(error) };
  }
}
