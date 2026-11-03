import { isDnsLabel, isDnsSubdomain } from '../core/object';
import { ClusterScope, namespaceScope } from '../core/scope';
import { ZtunnelResourceCandidate } from '../core/ztunnel';
import { observedResourceIdentity, readCluster, withDiagnosticDeadline } from './requests';

export async function loadZtunnelResourceCandidate(
  scope: ClusterScope,
  target: ZtunnelResourceCandidate,
  signal: AbortSignal
) {
  if (
    (target.kind !== 'Pod' && target.kind !== 'Service') ||
    !isDnsLabel(target.namespace) ||
    (target.kind === 'Pod' ? !isDnsSubdomain(target.name) : !isDnsLabel(target.name))
  )
    throw new Error('Ztunnel metadata does not identify a supported current resource');
  const captured = namespaceScope(scope.cluster, target.namespace);
  const plural = target.kind === 'Pod' ? 'pods' : 'services';
  return withDiagnosticDeadline(
    signal,
    'Ztunnel resource candidate lookup exceeded 15 seconds',
    async requestSignal => {
      const value = await readCluster(
        captured,
        `/api/v1/namespaces/${encodeURIComponent(target.namespace)}/${plural}/${encodeURIComponent(
          target.name
        )}`,
        requestSignal
      );
      const identity = observedResourceIdentity(value, {
        kind: target.kind,
        apiVersion: 'v1',
        namespace: target.namespace,
        name: target.name,
      });
      return {
        scope: captured,
        kind: target.kind,
        namespace: target.namespace,
        name: target.name,
        ...identity,
        checkedAt: new Date().toISOString(),
      };
    }
  );
}
