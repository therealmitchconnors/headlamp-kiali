import { DiagnosticPod } from '../core/diagnostics';
import { proxySyncSnapshot, proxySynczPath } from '../core/proxySync';
import { ClusterScope } from '../core/scope';
import { loadDiagnosticPod } from './diagnostics';
import { readClusterText, withDiagnosticDeadline } from './requests';

const SYNC_RESPONSE_LIMIT = 262144;

interface ControlPlaneSyncTarget {
  namespace: string;
  pod: string;
  uid: string;
  container: 'discovery';
  restarts: number;
  port: number;
}

function controlPlaneTarget(pod: DiagnosticPod): ControlPlaneSyncTarget {
  const discovery = pod.containers.find(container => container.name === 'discovery');
  if (!discovery)
    throw new Error('A selected discovery container is required to read control-plane sync status');
  if (discovery.restarts === null)
    throw new Error('The discovery container restart count is not reported; reload its identity');
  const ports = discovery.ports?.filter(port => port.name === 'http-debug') ?? [];
  if (ports.length !== 1)
    throw new Error('The selected discovery container must declare exactly one http-debug port');
  return {
    namespace: pod.namespace,
    pod: pod.name,
    uid: pod.uid,
    container: 'discovery',
    restarts: discovery.restarts,
    port: ports[0].containerPort,
  };
}

function sameControlPlaneTarget(first: ControlPlaneSyncTarget, second: ControlPlaneSyncTarget) {
  return (
    first.namespace === second.namespace &&
    first.pod === second.pod &&
    first.uid === second.uid &&
    first.container === second.container &&
    first.restarts === second.restarts &&
    first.port === second.port
  );
}

export async function loadProxySyncSnapshot(
  scope: ClusterScope,
  pod: DiagnosticPod,
  signal: AbortSignal
) {
  return withDiagnosticDeadline(
    signal,
    'The control-plane synchronization read exceeded 15 seconds',
    async requestSignal => {
      const before = await loadDiagnosticPod(
        scope,
        pod.namespace,
        pod.name,
        requestSignal
      );
      if (before.uid !== pod.uid)
        throw new Error('The control-plane Pod was replaced; reload its diagnostic identity');
      const target = controlPlaneTarget(before);
      const path = proxySynczPath(target.namespace, target.pod, target.port);
      const response = await readClusterText(scope, path, requestSignal, SYNC_RESPONSE_LIMIT);
      if (response.limited)
        throw new Error('The control-plane synchronization response exceeds 256 KiB');
      let payload: unknown;
      try {
        payload = JSON.parse(response.text);
      } catch {
        throw new Error('The control-plane synchronization response is not valid JSON');
      }
      const records = proxySyncSnapshot(payload);
      const after = await loadDiagnosticPod(
        scope,
        pod.namespace,
        pod.name,
        requestSignal
      );
      if (after.uid !== before.uid) throw new Error('The control-plane Pod changed during sync read');
      const current = controlPlaneTarget(after);
      if (!sameControlPlaneTarget(target, current))
        throw new Error('The discovery container identity changed during sync read');
      return {
        cluster: scope.cluster,
        target,
        records,
        capturedAt: new Date().toISOString(),
      };
    }
  );
}
