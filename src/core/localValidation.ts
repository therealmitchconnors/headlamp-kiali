import { isRecord } from './object';
import type { Finding } from './validation';

export function matchesPortName(name: string, protocol: string): boolean {
  const normalized = protocol.toLowerCase();
  return (
    normalized === 'tcp' ||
    normalized === 'udp' ||
    (name.startsWith(normalized) &&
      (name.length === normalized.length || name.slice(normalized.length).startsWith('-')))
  );
}

export interface GatewayCondition {
  type: string;
  status: string;
  reason: string;
  message: string;
}
const GATEWAY_STATUS: Readonly<Record<string, string>> = {
  Accepted: 'False',
  Programmed: 'False',
  Ready: 'False',
  Scheduled: 'False',
};
const LISTENER_STATUS: Readonly<Record<string, string>> = {
  Accepted: 'False',
  Conflicted: 'True',
  Detached: 'True',
  Programmed: 'False',
  Ready: 'False',
  ResolvedRefs: 'False',
};
export function problematicGatewayCondition(
  condition: GatewayCondition,
  listener = false
): boolean {
  const statuses = listener ? LISTENER_STATUS : GATEWAY_STATUS;
  if (
    !Object.prototype.hasOwnProperty.call(statuses, condition.type) ||
    statuses[condition.type] !== condition.status
  )
    return false;
  if (
    condition.status === 'False' &&
    ['Accepted', 'Programmed', 'Ready', 'ResolvedRefs', 'Scheduled'].includes(condition.type)
  ) {
    if (['Pending', 'ListenersNotValid', 'ListenerSetsNotValid'].includes(condition.reason))
      return false;
    if (
      condition.reason === 'AddressNotAssigned' &&
      condition.message.toLowerCase().includes('address pending')
    )
      return false;
  }
  return true;
}

export function localConfigurationChecks(
  kind: string,
  group: string,
  spec: Record<string, unknown>,
  status?: unknown,
  generation?: number
): { findings: Finding[]; skipped: string[] } {
  const findings: Finding[] = [];
  const skipped: string[] = [];
  if (
    kind === 'Sidecar' &&
    group === 'networking.istio.io' &&
    spec.outboundTrafficPolicy !== undefined
  ) {
    if (!isRecord(spec.outboundTrafficPolicy))
      skipped.push('Sidecar outbound traffic policy is malformed');
    else if (
      spec.outboundTrafficPolicy.mode === undefined ||
      spec.outboundTrafficPolicy.mode === null
    )
      findings.push({
        code: 'KIA1007',
        severity: 'unknown',
        path: 'spec/outboundTrafficPolicy',
        message:
          'OutboundTrafficPolicy with empty mode value is ambiguous due to an Istio limitation. This may indicate ALLOW_ANY or REGISTRY_ONLY. Inspect the value using other means.',
      });
    else if (!['ALLOW_ANY', 'REGISTRY_ONLY'].includes(String(spec.outboundTrafficPolicy.mode)))
      skipped.push('Sidecar outbound traffic mode is not recognized');
  }
  if (kind !== 'Gateway' || group !== 'gateway.networking.k8s.io') return { findings, skipped };
  if (!isRecord(status))
    return { findings, skipped: [...skipped, 'Gateway status is not reported'] };
  if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 1)
    return {
      findings,
      skipped: [...skipped, 'Gateway condition checks require the current resource generation'],
    };
  let count = 0;
  function conditions(value: unknown, path: string, listener: boolean) {
    if (value === undefined) return;
    if (!Array.isArray(value) || value.length > 100) {
      skipped.push(`${path}: condition list is malformed or exceeds 100 entries`);
      return;
    }
    value.forEach((condition, index) => {
      if (++count > 1000) return;
      const location = `${path}[${index}]`;
      if (
        !isRecord(condition) ||
        typeof condition.type !== 'string' ||
        typeof condition.status !== 'string' ||
        !['True', 'False', 'Unknown'].includes(condition.status) ||
        typeof condition.reason !== 'string' ||
        typeof condition.message !== 'string' ||
        condition.type.length > 1024 ||
        condition.reason.length > 1024 ||
        condition.message.length > 32768
      ) {
        skipped.push(`${location}: malformed condition`);
        return;
      }
      if (condition.observedGeneration !== generation) {
        skipped.push(`${location}: condition generation is missing, stale or inconsistent`);
        return;
      }
      if (condition.status === 'Unknown') {
        skipped.push(`${location}: controller status is unknown`);
        return;
      }
      if (
        problematicGatewayCondition(
          {
            type: condition.type,
            status: condition.status,
            reason: condition.reason,
            message: condition.message,
          },
          listener
        )
      )
        findings.push({
          code: 'GWAPI',
          severity: 'warning',
          path: `${location}/reason/${condition.reason}`,
          message: `${condition.message}. GWAPI errors should be changed in the spec.`,
        });
    });
  }
  conditions(status.conditions, 'status/conditions', false);
  if (status.listeners !== undefined) {
    if (!Array.isArray(status.listeners) || status.listeners.length > 64)
      skipped.push('Gateway listener status is malformed or exceeds 64 entries');
    else
      status.listeners.forEach((listener, index) => {
        if (!isRecord(listener))
          skipped.push(`status/listeners[${index}]: malformed listener status`);
        else conditions(listener.conditions, `status/listeners[${index}]/conditions`, true);
      });
  }
  if (count === 0) skipped.push('Gateway conditions are not reported');
  if (count > 1000) skipped.push('Gateway condition checks stopped at the 1,000-condition limit');
  return { findings, skipped };
}
