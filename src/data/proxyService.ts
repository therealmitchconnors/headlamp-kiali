import { isRecord } from '../core/object';
import { proxyServiceCandidate, ProxyServiceQuery } from '../core/proxyService';
import { ClusterScope, namespaceScope } from '../core/scope';
import {
  InvalidResponseError,
  observedResourceIdentity,
  readCluster,
  withDiagnosticDeadline,
} from './requests';

export async function loadProxyServiceCandidate(
  scope: ClusterScope,
  query: ProxyServiceQuery,
  signal: AbortSignal
) {
  const candidate = proxyServiceCandidate(query);
  if (candidate.available === false)
    throw new Error('The proxy name does not identify a scoped outbound Service candidate');
  const target = candidate.target;
  const captured = namespaceScope(scope.cluster, target.namespace);
  return withDiagnosticDeadline(
    signal,
    'Service candidate lookup exceeded 15 seconds',
    async requestSignal => {
      const value = await readCluster(
        captured,
        `/api/v1/namespaces/${encodeURIComponent(target.namespace)}/services/${encodeURIComponent(
          target.name
        )}`,
        requestSignal
      );
      if (!isRecord(value) || !isRecord(value.spec))
        throw new InvalidResponseError(
          'Service response does not match the requested identity and scope'
        );
      const { uid, resourceVersion } = observedResourceIdentity(value, {
        kind: 'Service',
        apiVersion: 'v1',
        namespace: target.namespace,
        name: target.name,
      });
      const text = (input: unknown, field: string): string | undefined => {
        if (input === undefined) return undefined;
        if (typeof input !== 'string' || input.length > 1024)
          throw new InvalidResponseError(`Service ${field} is malformed or oversized`);
        return input;
      };
      const rawPorts = value.spec.ports === undefined ? [] : value.spec.ports;
      if (!Array.isArray(rawPorts) || rawPorts.length > 100)
        throw new InvalidResponseError('Service ports are malformed or exceed 100 entries');
      const ports = rawPorts.map(port => {
        if (
          !isRecord(port) ||
          typeof port.port !== 'number' ||
          !Number.isInteger(port.port) ||
          port.port < 1 ||
          port.port > 65535
        )
          throw new InvalidResponseError('Invalid Service port number');
        return {
          port: port.port,
          name: text(port.name, 'port name'),
          protocol: text(port.protocol, 'port protocol'),
        };
      });
      return {
        scope: captured,
        target,
        identity: {
          cluster: captured.cluster,
          namespace: captured.namespace,
          group: '',
          kind: 'Service' as const,
          name: target.name,
          uid,
        },
        resourceVersion,
        serviceType: text(value.spec.type, 'type'),
        externalName: text(value.spec.externalName, 'external name'),
        ports,
        portDeclared: ports.some(port => port.port === target.port),
        checkedAt: new Date().toISOString(),
      };
    }
  );
}
