import { isRecord } from '../core/object';
import { ClusterScope } from '../core/scope';
import type { ConfigurationDefinition } from '../resources/registry';
import { InvalidResponseError, readCluster, readFailure } from './requests';

export type ResourceAvailability =
  | { available: true; apiVersion: string }
  | { available: false; reason: 'absent' | 'unsupported-version' };

/** Discovery avoids requiring cluster-wide CRD read permission to view namespaced resources. */
export async function discoverConfiguration(
  scope: ClusterScope,
  definition: ConfigurationDefinition,
  signal: AbortSignal
): Promise<ResourceAvailability> {
  let group: unknown;
  try {
    group = await readCluster(scope, `/apis/${definition.group}`, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    if (readFailure(error).kind === 'not-found') return { available: false, reason: 'absent' };
    throw error;
  }
  if (!isRecord(group) || group.name !== definition.group || !Array.isArray(group.versions)) {
    throw new InvalidResponseError('Invalid API group discovery response');
  }
  const served = new Set(
    group.versions.map((version: unknown) => {
      if (!isRecord(version) || typeof version.groupVersion !== 'string') {
        throw new InvalidResponseError('Invalid API group version');
      }
      return version.groupVersion;
    })
  );
  const supported = definition.resourceClass.apiVersion;
  const versions = (Array.isArray(supported) ? supported : [supported]).filter(version =>
    served.has(version)
  );
  if (!versions.length) return { available: false, reason: 'unsupported-version' };
  for (const version of versions) {
    const response = await readCluster(scope, `/apis/${version}`, signal);
    if (
      !isRecord(response) ||
      response.groupVersion !== version ||
      !Array.isArray(response.resources)
    ) {
      throw new InvalidResponseError('Invalid API resource discovery response');
    }
    const resource = response.resources.find(
      (entry: unknown) =>
        isRecord(entry) && entry.name === definition.plural && entry.kind === definition.kind
    );
    if (resource !== undefined) {
      if (!isRecord(resource) || resource.namespaced !== definition.resourceClass.isNamespaced) {
        throw new InvalidResponseError('Unexpected scope for configuration resource');
      }
      return { available: true, apiVersion: version };
    }
  }
  return { available: false, reason: 'absent' };
}
