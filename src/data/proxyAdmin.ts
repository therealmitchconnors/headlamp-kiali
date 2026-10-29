import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { DiagnosticPod } from '../core/diagnostics';
import { ProxyHttpResponse } from '../core/proxyHttp';
import { ClusterScope } from '../core/scope';
import { loadDiagnosticPod } from './diagnostics';
import { withDiagnosticDeadline } from './requests';

export type ProxyRead = 'server-info' | 'configuration' | 'ztunnel-configuration';
const endpoints = {
  'server-info': { path: '/server_info', maxBytes: 262144 },
  configuration: { path: '/config_dump', maxBytes: 4194304 },
  'ztunnel-configuration': { path: '/config_dump', maxBytes: 4194304 },
} as const;

function readAdmin(
  scope: ClusterScope,
  pod: DiagnosticPod,
  read: ProxyRead,
  signal: AbortSignal
): Promise<unknown> {
  signal.throwIfAborted();
  if (typeof ApiProxy.stream !== 'function')
    throw new Error('This Headlamp host does not support the public proxy stream transport');
  const endpoint = endpoints[read];
  return new Promise((resolve, reject) => {
    const transport: { connection?: ReturnType<typeof ApiProxy.stream> } = {};
    const response = new ProxyHttpResponse(endpoint.maxBytes);
    const greeted = new Set<number>();
    let finished = false;
    let sent = false;
    const observeSocket = setInterval(() => {
      if (!transport.connection?.getSocket()) return;
      clearInterval(observeSocket);
      clearTimeout(observeDeadline);
      if (finished) transport.connection.cancel();
    }, 50);
    const observeDeadline = setTimeout(() => {
      clearInterval(observeSocket);
      if (finished) closeAvailable();
      if (!transport.connection?.getSocket())
        console.warn(
          'Headlamp did not expose a proxy socket within 15 seconds; late messages will be cancelled'
        );
    }, 15000);
    const abort = () => finish(new DOMException('Proxy read cancelled', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });

    function closeAvailable() {
      transport.connection?.cancel();
      if (transport.connection?.getSocket()) {
        clearInterval(observeSocket);
        clearTimeout(observeDeadline);
      }
    }
    function finish(error?: Error) {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', abort);
      closeAvailable();
      if (error) reject(error);
      else {
        try {
          resolve(response.json());
        } catch (error) {
          reject(error);
        }
      }
    }
    // Older hosts may assign the socket after cancel(). Observe that public handle
    // briefly, and also cancel on any late frame; never send after cancellation.
    try {
      transport.connection = ApiProxy.stream(
        `/api/v1/namespaces/${pod.namespace}/pods/${pod.name}/portforward?ports=15000`,
        (message: unknown) => {
          if (finished) {
            closeAvailable();
            return;
          }
          try {
            if (!(message instanceof ArrayBuffer))
              throw new Error('Unsupported port-forward frame type');
            const bytes = new Uint8Array(message);
            if (!bytes.length || bytes[0] > 1) throw new Error('Unexpected port-forward channel');
            const channel = bytes[0];
            let data = bytes.subarray(1);
            if (!greeted.has(channel)) {
              if (data.length < 2 || data[0] + data[1] * 256 !== 15000)
                throw new Error('Port-forward stream reported a different target port');
              greeted.add(channel);
              data = data.subarray(2);
            }
            const socket = transport.connection?.getSocket();
            if (!socket || socket.protocol !== 'v4.channel.k8s.io')
              throw new Error('The host did not negotiate the supported port-forward protocol');
            if (channel === 1 && data.length)
              throw new Error(
                `Pod admin port-forward failed: ${new TextDecoder().decode(data.subarray(0, 512))}`
              );
            if (!sent && channel === 0) {
              const request = new TextEncoder().encode(
                `GET ${endpoint.path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nAccept: application/json\r\nAccept-Encoding: identity\r\n\r\n`
              );
              const frame = new Uint8Array(request.length + 1);
              frame.set(request, 1);
              sent = true;
              socket.send(frame);
            }
            if (channel !== 0 || !data.length) return;
            response.push(data);
            if (response.complete) finish();
          } catch (error) {
            finish(error instanceof Error ? error : new Error('Proxy admin transport failed'));
          }
        },
        {
          cluster: scope.cluster,
          isJson: false,
          additionalProtocols: ['v4.channel.k8s.io'],
          reconnectOnFailure: false,
          failCb: () =>
            finish(
              new Error(
                'Proxy admin stream closed before a complete response or was refused; check pod port-forward permissions and host support'
              )
            ),
        }
      );
    } catch (error) {
      clearInterval(observeSocket);
      clearTimeout(observeDeadline);
      finish(error instanceof Error ? error : new Error('Proxy connection failed'));
    }
    if (finished) closeAvailable();
  });
}

export async function loadProxySnapshot(
  scope: ClusterScope,
  pod: DiagnosticPod,
  read: ProxyRead,
  signal: AbortSignal
) {
  if (read !== 'server-info' && read !== 'configuration' && read !== 'ztunnel-configuration')
    throw new Error('Unsupported read-only proxy operation');
  return withDiagnosticDeadline(
    signal,
    'The proxy read exceeded 15 seconds',
    async requestSignal => {
      const before = await loadDiagnosticPod(scope, pod.namespace, pod.name, requestSignal);
      if (before.uid !== pod.uid)
        throw new Error('The pod was replaced; reload its diagnostic identity');
      const proxy =
        (read === 'ztunnel-configuration' &&
          before.containers.find(container => container.name === 'ztunnel')) ||
        before.containers.find(container => container.name === 'istio-proxy');
      if (!proxy)
        throw new Error(
          read === 'ztunnel-configuration'
            ? 'An observed istio-proxy or ztunnel container is required'
            : 'An observed istio-proxy container is required'
        );
      const data = await readAdmin(scope, before, read, requestSignal);
      const after = await loadDiagnosticPod(scope, pod.namespace, pod.name, requestSignal);
      const current = after.containers.find(container => container.name === proxy.name);
      if (after.uid !== before.uid || !current || current.restarts !== proxy.restarts)
        throw new Error('Pod identity or proxy restart count changed while reading diagnostics');
      return {
        data,
        capturedAt: new Date().toISOString(),
        restartVerified: proxy.restarts !== null,
      };
    }
  );
}
