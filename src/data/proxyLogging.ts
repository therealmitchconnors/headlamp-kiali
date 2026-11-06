import { DiagnosticPod } from '../core/diagnostics';
import {
  parseProxyLoggerLevels,
  ProxyLoggingProposal,
  proxyLoggingProposal,
  ProxyLoggingSnapshot,
  proxyLoggingStateMatches,
} from '../core/proxyLogging';
import { ClusterScope } from '../core/scope';
import { loadDiagnosticPod } from './diagnostics';
import { readProxyLoggingLevels, setProxyLoggingLevel } from './proxyAdmin';
import { withDiagnosticDeadline } from './requests';

function proxyTarget(pod: DiagnosticPod): ProxyLoggingSnapshot['target'] {
  const proxy = pod.containers.find(container => container.name === 'istio-proxy');
  if (!proxy)
    throw new Error('An observed istio-proxy container is required for proxy logging controls');
  if (proxy.restarts === null)
    throw new Error('The proxy restart count is not reported; reload its diagnostic identity');
  return {
    namespace: pod.namespace,
    pod: pod.name,
    uid: pod.uid,
    container: 'istio-proxy',
    restarts: proxy.restarts,
  };
}

function sameTarget(
  first: ProxyLoggingSnapshot['target'],
  second: ProxyLoggingSnapshot['target']
): boolean {
  return (
    first.namespace === second.namespace &&
    first.pod === second.pod &&
    first.uid === second.uid &&
    first.container === second.container &&
    first.restarts === second.restarts
  );
}

export async function loadProxyLoggingSnapshot(
  scope: ClusterScope,
  pod: DiagnosticPod,
  signal: AbortSignal
): Promise<ProxyLoggingSnapshot> {
  return withDiagnosticDeadline(signal, 'The proxy logging read exceeded 15 seconds', async requestSignal => {
    const before = await loadDiagnosticPod(scope, pod.namespace, pod.name, requestSignal);
    if (before.uid !== pod.uid)
      throw new Error('The proxy Pod was replaced; reload its diagnostic identity');
    const target = proxyTarget(before);
    const loggers = parseProxyLoggerLevels(
      await readProxyLoggingLevels(scope, before, requestSignal)
    );
    const after = await loadDiagnosticPod(scope, pod.namespace, pod.name, requestSignal);
    if (after.uid !== before.uid) throw new Error('The proxy Pod changed while reading log levels');
    if (!sameTarget(target, proxyTarget(after)))
      throw new Error('The proxy container identity changed while reading log levels');
    return {
      cluster: scope.cluster,
      target,
      loggers,
      capturedAt: new Date().toISOString(),
    };
  });
}

export class ProxyLoggingOutcomeError extends Error {
  readonly outcome = 'unknown';
}

export async function applyProxyLoggingProposal(
  scope: ClusterScope,
  pod: DiagnosticPod,
  proposal: ProxyLoggingProposal,
  signal: AbortSignal
): Promise<ProxyLoggingSnapshot> {
  if (
    proposal.cluster !== scope.cluster ||
    proposal.target.namespace !== pod.namespace ||
    proposal.target.pod !== pod.name ||
    proposal.target.uid !== pod.uid
  )
    throw new Error('The captured proxy logging target no longer matches the selected Pod');
  const validated = proxyLoggingProposal(
    {
      cluster: proposal.cluster,
      target: proposal.target,
      capturedAt: proposal.capturedAt,
      loggers: proposal.currentLoggers,
    },
    proposal.level
  );
  let submitted = false;
  try {
    return await withDiagnosticDeadline(
      signal,
      'The confirmed proxy logging operation exceeded 15 seconds',
      async requestSignal => {
        const current = await loadProxyLoggingSnapshot(scope, pod, requestSignal);
        if (
          !sameTarget(validated.target, current.target) ||
          !proxyLoggingStateMatches(validated.currentLoggers, current.loggers)
        )
          throw new Error(
            'Captured proxy identity or logger levels changed; review a new proposal'
          );
        submitted = true;
        try {
          const applied = parseProxyLoggerLevels(
            await setProxyLoggingLevel(scope, pod, validated.level, requestSignal)
          );
          if (applied.some(logger => logger.level !== validated.level))
            throw new Error('The proxy did not report the proposed level for every logger');
          const verified = await loadProxyLoggingSnapshot(scope, pod, requestSignal);
          if (
            !sameTarget(validated.target, verified.target) ||
            verified.loggers.some(logger => logger.level !== validated.level)
          )
            throw new Error('The proxy did not retain the proposed level for every logger');
          return verified;
        } catch {
          throw new ProxyLoggingOutcomeError(
            'The confirmed proxy logging request did not return a verifiable final state. Read current levels before retrying.'
          );
        }
      }
    );
  } catch (error) {
    if (submitted && !(error instanceof ProxyLoggingOutcomeError))
      throw new ProxyLoggingOutcomeError(
        'The confirmed proxy logging request may have been accepted, but its final state could not be verified. Read current levels before retrying.'
      );
    throw error;
  }
}
