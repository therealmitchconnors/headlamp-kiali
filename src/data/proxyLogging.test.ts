import { DiagnosticPod } from '../core/diagnostics';
import {
  proxyLoggingProposal,
  ProxyLoggingSnapshot,
} from '../core/proxyLogging';
import { clusterScope } from '../core/scope';
import { loadDiagnosticPod } from './diagnostics';
import { readProxyLoggingLevels, setProxyLoggingLevel } from './proxyAdmin';
import {
  applyProxyLoggingProposal,
  loadProxyLoggingSnapshot,
  ProxyLoggingOutcomeError,
} from './proxyLogging';

vi.mock('./diagnostics', () => ({ loadDiagnosticPod: vi.fn() }));
vi.mock('./proxyAdmin', () => ({
  readProxyLoggingLevels: vi.fn(),
  setProxyLoggingLevel: vi.fn(),
}));

const pod: DiagnosticPod = {
  namespace: 'bookinfo',
  name: 'reviews-v1',
  uid: 'owned-fixture-pod-uid',
  containers: [
    { name: 'istio-proxy', type: 'regular', nativeSidecar: false, ready: true, restarts: 2 },
  ],
};
const current = 'active loggers:\nrouter: warning\nupstream: info\n';
const updated = 'active loggers:\nrouter: debug\nupstream: debug\n';
const snapshot: ProxyLoggingSnapshot = {
  cluster: 'alpha',
  target: {
    namespace: pod.namespace,
    pod: pod.name,
    uid: pod.uid,
    container: 'istio-proxy',
    restarts: 2,
  },
  capturedAt: '2026-10-29T12:00:00.000Z',
  loggers: [
    { logger: 'router', level: 'warning' },
    { logger: 'upstream', level: 'info' },
  ],
};

beforeEach(() => {
  vi.useRealTimers();
  vi.mocked(loadDiagnosticPod).mockReset().mockResolvedValue(pod);
  vi.mocked(readProxyLoggingLevels).mockReset().mockResolvedValue(current);
  vi.mocked(setProxyLoggingLevel).mockReset().mockResolvedValue(updated);
});

afterEach(() => {
  vi.useRealTimers();
});

it('captures only the named proxy container and verifies Pod UID/restarts around the read', async () => {
  const result = await loadProxyLoggingSnapshot(
    clusterScope('alpha'),
    pod,
    new AbortController().signal
  );
  expect(result).toMatchObject({
    cluster: 'alpha',
    target: snapshot.target,
    loggers: snapshot.loggers,
  });
  expect(loadDiagnosticPod).toHaveBeenCalledTimes(2);
  expect(readProxyLoggingLevels).toHaveBeenCalledWith(
    { cluster: 'alpha' },
    pod,
    expect.any(AbortSignal)
  );
});

it('projects the real indented Envoy logger response into the captured snapshot', async () => {
  vi.mocked(readProxyLoggingLevels).mockResolvedValueOnce(
    'active loggers:\r\n  a2a: warning\r\n  admin: warning\r\n  alternate_protocols_cache: warning\r\n'
  );
  const result = await loadProxyLoggingSnapshot(
    clusterScope('alpha'),
    pod,
    new AbortController().signal
  );
  expect(result.loggers).toEqual([
    { logger: 'a2a', level: 'warning' },
    { logger: 'admin', level: 'warning' },
    { logger: 'alternate_protocols_cache', level: 'warning' },
  ]);
  expect(setProxyLoggingLevel).not.toHaveBeenCalled();
});

it.each(['uid', 'restart'])('rejects a stale %s before allowing a proposal', async change => {
  const changed: DiagnosticPod =
    change === 'uid'
      ? { ...pod, uid: 'replacement-uid' }
      : { ...pod, containers: [{ ...pod.containers[0], restarts: 3 }] };
  vi.mocked(loadDiagnosticPod).mockResolvedValueOnce(pod).mockResolvedValueOnce(changed);
  await expect(
    loadProxyLoggingSnapshot(clusterScope('alpha'), pod, new AbortController().signal)
  ).rejects.toThrow(change === 'uid' ? 'changed while reading' : 'identity changed');
});

it('re-reads captured state before the only fixture-targeted update and verifies the outcome', async () => {
  const proposal = proxyLoggingProposal(snapshot, 'debug');
  vi.mocked(readProxyLoggingLevels)
    .mockResolvedValueOnce(current)
    .mockResolvedValueOnce(updated);
  const result = await applyProxyLoggingProposal(
    clusterScope('alpha'),
    pod,
    proposal,
    new AbortController().signal
  );
  expect(setProxyLoggingLevel).toHaveBeenCalledTimes(1);
  expect(setProxyLoggingLevel).toHaveBeenCalledWith(
    { cluster: 'alpha' },
    pod,
    'debug',
    expect.any(AbortSignal)
  );
  expect(result.loggers.every(logger => logger.level === 'debug')).toBe(true);
});

it('blocks a stale current-state proposal before any update request', async () => {
  const proposal = proxyLoggingProposal(snapshot, 'debug');
  vi.mocked(readProxyLoggingLevels).mockResolvedValueOnce('active loggers:\nrouter: error\n');
  await expect(
    applyProxyLoggingProposal(
      clusterScope('alpha'),
      pod,
      proposal,
      new AbortController().signal
    )
  ).rejects.toThrow('logger levels changed');
  expect(setProxyLoggingLevel).not.toHaveBeenCalled();
});

it('reports a post-confirmation failure as unknown without retrying the mutation', async () => {
  vi.mocked(setProxyLoggingLevel).mockRejectedValueOnce(new Error('synthetic HTTP 503'));
  const proposal = proxyLoggingProposal(snapshot, 'debug');
  await expect(
    applyProxyLoggingProposal(
      clusterScope('alpha'),
      pod,
      proposal,
      new AbortController().signal
    )
  ).rejects.toBeInstanceOf(ProxyLoggingOutcomeError);
  expect(setProxyLoggingLevel).toHaveBeenCalledTimes(1);
  expect(readProxyLoggingLevels).toHaveBeenCalledTimes(1);
});

it('marks a late confirmed operation unknown after timeout and never retries it', async () => {
  vi.useFakeTimers();
  let resolveLate: (value: string) => void = () => {};
  vi.mocked(readProxyLoggingLevels)
    .mockResolvedValueOnce(current);
  vi.mocked(setProxyLoggingLevel).mockImplementation(
    () =>
      new Promise(resolve => {
        resolveLate = resolve;
      })
  );
  const proposal = proxyLoggingProposal(snapshot, 'debug');
  const pending = applyProxyLoggingProposal(
    clusterScope('alpha'),
    pod,
    proposal,
    new AbortController().signal
  );
  const assertion = expect(pending).rejects.toBeInstanceOf(ProxyLoggingOutcomeError);
  await vi.advanceTimersByTimeAsync(15000);
  await assertion;
  resolveLate(updated);
  await Promise.resolve();
  expect(setProxyLoggingLevel).toHaveBeenCalledTimes(1);
  expect(readProxyLoggingLevels).toHaveBeenCalledTimes(1);
});
