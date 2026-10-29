import {
  ProxyConfigurationQuery,
  proxyConfigurationTarget,
} from '../core/proxyConfigurationReference';
import { ClusterScope, namespaceScope } from '../core/scope';
import { configurationDefinitions } from '../resources/registry';
import { discoverConfiguration } from './configuration';
import { observedResourceIdentity, readCluster, withDiagnosticDeadline } from './requests';

export async function loadProxyConfigurationCandidate(
  scope: ClusterScope,
  query: ProxyConfigurationQuery,
  signal: AbortSignal
) {
  const target = proxyConfigurationTarget(query);
  if (target.available === false)
    throw new Error(
      'Proxy metadata does not identify a canonical supported configuration reference'
    );
  const captured = namespaceScope(scope.cluster, target.namespace);
  const definition = configurationDefinitions.find(
    item => item.kind === target.kind && item.group === 'networking.istio.io'
  );
  if (!definition) throw new Error('Configuration reference model is unavailable');
  return withDiagnosticDeadline(
    signal,
    'Configuration candidate lookup exceeded 15 seconds',
    async requestSignal => {
      const available = await discoverConfiguration(captured, definition, requestSignal);
      if (available.available === false)
        throw new Error(`${target.kind} API unavailable: ${available.reason}`);
      const value = await readCluster(
        captured,
        `/apis/${available.apiVersion}/namespaces/${encodeURIComponent(target.namespace)}/${
          definition.plural
        }/${encodeURIComponent(target.name)}`,
        requestSignal
      );
      const identity = observedResourceIdentity(value, {
        kind: target.kind,
        apiVersion: available.apiVersion,
        namespace: target.namespace,
        name: target.name,
      });
      return {
        cluster: captured.cluster,
        namespace: target.namespace,
        name: target.name,
        kind: target.kind,
        ...identity,
        apiVersion: available.apiVersion,
        observedApiVersion: target.observedApiVersion,
        routeName: definition.resourceClass.detailsRoute,
        checkedAt: new Date().toISOString(),
      };
    }
  );
}
