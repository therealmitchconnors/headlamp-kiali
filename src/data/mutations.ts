import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { isDnsLabel, isDnsSubdomain, isRecord } from '../core/object';
import { VALIDATION_IGNORE_ANNOTATION } from '../core/validationAnnotations';
import { ConfigurationObject } from '../resources/common';
import { ConfigurationDefinition } from '../resources/registry';
import { InvalidResponseError, readCluster } from './requests';

export interface MutationTarget {
  readonly cluster: string;
  readonly definition: ConfigurationDefinition;
  readonly apiVersion: string;
  readonly namespace: string;
  readonly name: string;
}

export interface PreparedMutation {
  readonly target: MutationTarget;
  readonly action: 'create' | 'update' | 'delete';
  readonly original?: { readonly uid: string; readonly resourceVersion: string };
  readonly spec?: object;
  readonly validationExclusions?: { readonly value: string | null };
}

export class MutationConflict extends Error {}

function assertAction(action: PreparedMutation['action']) {
  if (!['create', 'update', 'delete'].includes(action))
    throw new Error('Unsupported configuration mutation action');
}

function freezeSpecification(spec: object): object {
  const pending = [spec];
  while (pending.length) {
    const value = pending.pop()!;
    for (const child of Object.values(value))
      if (typeof child === 'object' && child !== null) pending.push(child);
    Object.freeze(value);
  }
  return spec;
}

function collectionPath(target: MutationTarget) {
  const versions = target.definition.resourceClass.apiVersion;
  if (
    !target.cluster.trim() ||
    (target.definition.resourceClass.isNamespaced
      ? !isDnsLabel(target.namespace)
      : target.namespace !== '') ||
    !isDnsSubdomain(target.name) ||
    !(Array.isArray(versions) ? versions : [versions]).includes(target.apiVersion)
  )
    throw new Error('Invalid configuration mutation target');
  const namespace = target.definition.resourceClass.isNamespaced
    ? `/namespaces/${encodeURIComponent(target.namespace)}`
    : '';
  return `/apis/${target.apiVersion}${namespace}/${target.definition.plural}`;
}

function originalIdentity(target: MutationTarget, original?: ConfigurationObject<object>) {
  if (
    !original?.metadata.uid ||
    !original.metadata.resourceVersion ||
    original.metadata.name !== target.name ||
    (original.metadata.namespace ?? '') !== target.namespace ||
    original.kind !== target.definition.kind ||
    original.apiVersion !== target.apiVersion
  )
    throw new Error('The original resource identity and version are required');
  return Object.freeze({
    uid: original.metadata.uid,
    resourceVersion: original.metadata.resourceVersion,
  });
}

export function prepareMutation(
  target: MutationTarget,
  action: PreparedMutation['action'],
  specText: string,
  original?: ConfigurationObject<object>
): PreparedMutation {
  assertAction(action);
  collectionPath(target);
  let spec: unknown;
  if (action !== 'delete') {
    try {
      spec = JSON.parse(specText);
    } catch {
      throw new Error('The specification must be valid JSON');
    }
    if (!isRecord(spec)) throw new Error('The specification must be a JSON object');
  }
  const identity = action === 'create' ? undefined : originalIdentity(target, original);
  return Object.freeze({
    target: Object.freeze({ ...target }),
    action,
    ...(isRecord(spec) ? { spec: freezeSpecification(spec) } : {}),
    ...(identity ? { original: identity } : {}),
  });
}

export function prepareValidationExclusions(
  target: MutationTarget,
  value: string | null,
  original: ConfigurationObject<object>
): PreparedMutation {
  collectionPath(target);
  const identity = originalIdentity(target, original);
  if (value !== null && (typeof value !== 'string' || value.length > 4096))
    throw new Error('Invalid validation exclusion annotation value');
  const annotations = original.metadata.annotations ?? {};
  if (!isRecord(annotations) || Object.values(annotations).some(value => typeof value !== 'string'))
    throw new Error('The original annotations are malformed');
  const previous = Object.prototype.hasOwnProperty.call(annotations, VALIDATION_IGNORE_ANNOTATION)
    ? annotations[VALIDATION_IGNORE_ANNOTATION]
    : null;
  if (previous === value) throw new Error('Validation exclusions have not changed');
  return Object.freeze({
    target: Object.freeze({ ...target }),
    action: 'update',
    original: identity,
    validationExclusions: Object.freeze({ value }),
  });
}

export async function assertMutationPermission(mutation: PreparedMutation, signal: AbortSignal) {
  assertAction(mutation.action);
  const target = mutation.target;
  collectionPath(target);
  signal.throwIfAborted();
  const response: unknown = await ApiProxy.request(
    '/apis/authorization.k8s.io/v1/selfsubjectaccessreviews',
    {
      cluster: target.cluster,
      method: 'POST',
      signal,
      autoLogoutOnAuthError: false,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiVersion: 'authorization.k8s.io/v1',
        kind: 'SelfSubjectAccessReview',
        spec: {
          resourceAttributes: {
            group: target.definition.group,
            version: target.apiVersion.split('/')[1],
            resource: target.definition.plural,
            ...(target.definition.resourceClass.isNamespaced
              ? { namespace: target.namespace }
              : {}),
            ...(mutation.action === 'create' ? {} : { name: target.name }),
            verb: mutation.action === 'update' ? 'update' : mutation.action,
          },
        },
      }),
    },
    false
  );
  if (
    !isRecord(response) ||
    !isRecord(response.status) ||
    typeof response.status.allowed !== 'boolean'
  ) {
    throw new InvalidResponseError('Invalid authorization review response');
  }
  if (!response.status.allowed) {
    throw new Error(
      typeof response.status.reason === 'string' && response.status.reason
        ? response.status.reason
        : 'You do not have permission for this operation'
    );
  }
}

/** Recheck permission and identity immediately before the single atomic API operation. */
export async function executeMutation(
  mutation: PreparedMutation,
  dryRun: boolean,
  signal: AbortSignal,
  beforeWrite?: () => void
): Promise<void> {
  assertAction(mutation.action);
  if (typeof dryRun !== 'boolean') throw new Error('A boolean dry-run decision is required');
  const target = mutation.target;
  const collection = collectionPath(target);
  const annotationChange = mutation.validationExclusions;
  if (annotationChange !== undefined) {
    if (
      mutation.action !== 'update' ||
      mutation.spec !== undefined ||
      !isRecord(annotationChange) ||
      (annotationChange.value !== null &&
        (typeof annotationChange.value !== 'string' || annotationChange.value.length > 4096))
    )
      throw new Error('Validation exclusion updates cannot be combined with specification changes');
  } else if (mutation.action !== 'delete' && !isRecord(mutation.spec)) {
    throw new Error('A configuration specification is required');
  }
  await assertMutationPermission(mutation, signal);
  const itemPath = `${collection}/${encodeURIComponent(target.name)}`;
  let current: Record<string, unknown> | undefined;
  if (mutation.action !== 'create') {
    const response = await readCluster(target, itemPath, signal);
    if (
      !isRecord(response) ||
      !isRecord(response.metadata) ||
      response.kind !== target.definition.kind ||
      response.apiVersion !== target.apiVersion
    )
      throw new InvalidResponseError('Invalid resource response');
    if (
      response.metadata.uid !== mutation.original?.uid ||
      response.metadata.resourceVersion !== mutation.original.resourceVersion ||
      response.metadata.name !== target.name ||
      (response.metadata.namespace ?? '') !== target.namespace
    )
      throw new MutationConflict(
        'The resource changed or was replaced. Close this dialog and reload before editing.'
      );
    current = response;
  }
  let body: Record<string, unknown> =
    mutation.action === 'delete'
      ? {
          apiVersion: 'v1',
          kind: 'DeleteOptions',
          preconditions: mutation.original,
        }
      : mutation.action === 'create'
      ? {
          apiVersion: target.apiVersion,
          kind: target.definition.kind,
          metadata: {
            name: target.name,
            ...(target.definition.resourceClass.isNamespaced
              ? { namespace: target.namespace }
              : {}),
          },
          spec: mutation.spec,
        }
      : { ...current, spec: mutation.spec };
  if (annotationChange !== undefined) {
    if (!current || !isRecord(current.metadata))
      throw new InvalidResponseError('The current resource metadata is unavailable');
    const existing = current.metadata.annotations ?? {};
    if (!isRecord(existing) || Object.values(existing).some(value => typeof value !== 'string'))
      throw new InvalidResponseError('The current resource annotations are malformed');
    const annotations = Object.fromEntries(Object.entries(existing));
    if (annotationChange.value === null) delete annotations[VALIDATION_IGNORE_ANNOTATION];
    else annotations[VALIDATION_IGNORE_ANNOTATION] = annotationChange.value;
    body = { ...current, metadata: { ...current.metadata, annotations } };
  }
  signal.throwIfAborted();
  const path = mutation.action === 'create' ? collection : itemPath;
  beforeWrite?.();
  const result: unknown = await ApiProxy.request(
    `${path}${dryRun ? '?dryRun=All' : ''}`,
    {
      cluster: target.cluster,
      method:
        mutation.action === 'create' ? 'POST' : mutation.action === 'update' ? 'PUT' : 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
      autoLogoutOnAuthError: false,
    },
    false
  );
  if (annotationChange !== undefined) {
    if (
      !isRecord(result) ||
      !isRecord(result.metadata) ||
      result.apiVersion !== target.apiVersion ||
      result.kind !== target.definition.kind ||
      result.metadata.name !== target.name ||
      (result.metadata.namespace ?? '') !== target.namespace ||
      result.metadata.uid !== mutation.original?.uid ||
      typeof result.metadata.resourceVersion !== 'string' ||
      !result.metadata.resourceVersion
    )
      throw new InvalidResponseError(
        'The annotation operation returned an unexpected resource; reload before any further operation'
      );
    const annotations = result.metadata.annotations ?? {};
    if (
      !isRecord(annotations) ||
      Object.values(annotations).some(value => typeof value !== 'string') ||
      (annotationChange.value === null
        ? Object.prototype.hasOwnProperty.call(annotations, VALIDATION_IGNORE_ANNOTATION)
        : annotations[VALIDATION_IGNORE_ANNOTATION] !== annotationChange.value)
    )
      throw new InvalidResponseError(
        'The server did not return the proposed validation exclusions; reload before any further operation'
      );
  }
}
