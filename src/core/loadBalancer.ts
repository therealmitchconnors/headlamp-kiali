import { editableObject, isRecord } from './object';

export const SIMPLE_LOAD_BALANCERS = [
  'ROUND_ROBIN',
  'LEAST_REQUEST',
  'LEAST_CONN',
  'RANDOM',
  'PASSTHROUGH',
  'UNSPECIFIED',
] as const;
type SimpleAlgorithm = (typeof SIMPLE_LOAD_BALANCERS)[number];
export interface LoadBalancerDraft {
  mode: 'keep' | 'set' | 'remove';
  strategy: 'simple' | 'header' | 'cookie' | 'source-ip';
  simple: SimpleAlgorithm;
  header: string;
  cookieName: string;
  cookieTtl: string;
}
export type LoadBalancerChoice =
  | { simple: SimpleAlgorithm }
  | {
      consistentHash:
        | { httpHeaderName: string }
        | { httpCookie: { name: string; ttl: string } }
        | { useSourceIp: true };
    };

function simpleAlgorithm(value: unknown): value is SimpleAlgorithm {
  return typeof value === 'string' && SIMPLE_LOAD_BALANCERS.some(mode => mode === value);
}
export function initialLoadBalancer(spec?: unknown): LoadBalancerDraft {
  const policy = isRecord(spec) && isRecord(spec.trafficPolicy) ? spec.trafficPolicy : {};
  const value = isRecord(policy.loadBalancer) ? policy.loadBalancer : {};
  const hash = isRecord(value.consistentHash) ? value.consistentHash : {};
  const cookie = isRecord(hash.httpCookie) ? hash.httpCookie : {};
  return {
    mode: 'keep',
    strategy:
      value.simple !== undefined && value.simple !== null
        ? 'simple'
        : typeof hash.httpHeaderName === 'string'
        ? 'header'
        : isRecord(hash.httpCookie)
        ? 'cookie'
        : hash.useSourceIp !== undefined
        ? 'source-ip'
        : 'simple',
    simple: simpleAlgorithm(value.simple) ? value.simple : 'ROUND_ROBIN',
    header: typeof hash.httpHeaderName === 'string' ? hash.httpHeaderName : '',
    cookieName: typeof cookie.name === 'string' ? cookie.name : '',
    cookieTtl: typeof cookie.ttl === 'string' ? cookie.ttl : '0s',
  };
}
function token(value: unknown, field: string, pseudoHeader = false): string {
  if (
    typeof value !== 'string' ||
    value.length > 256 ||
    !(
      /^[!#$%&'*+\-.^_`|~A-Za-z0-9]+$/.exec(value)?.[0] === value ||
      (pseudoHeader && /^:[a-z]+$/.exec(value)?.[0] === value)
    )
  )
    throw new Error(`${field} must be a nonempty HTTP token of at most 256 characters`);
  return value;
}
export function cookieDuration(value: string): string {
  const match =
    typeof value === 'string' && value.length <= 64 && /^(\d+)(?:\.\d{1,9})?s$/.exec(value);
  if (
    !match ||
    match[0] !== value ||
    !Number.isSafeInteger(Number(match[1])) ||
    Number(match[1]) > 315576000000
  )
    throw new Error(
      'Cookie TTL must be nonnegative protobuf seconds, such as 0s or 30s, with at most nine fractional digits'
    );
  return value;
}
export function loadBalancerChange(
  draft: LoadBalancerDraft
): LoadBalancerChoice | null | undefined {
  if (!['keep', 'set', 'remove'].includes(draft.mode))
    throw new Error('Unknown load-balancer edit action');
  if (draft.mode === 'keep') return undefined;
  if (draft.mode === 'remove') return null;
  if (draft.strategy === 'simple') {
    if (!simpleAlgorithm(draft.simple)) throw new Error('Unknown simple load-balancing algorithm');
    return { simple: draft.simple };
  }
  if (draft.strategy === 'header')
    return { consistentHash: { httpHeaderName: token(draft.header, 'HTTP header name', true) } };
  if (draft.strategy === 'cookie')
    return {
      consistentHash: {
        httpCookie: {
          name: token(draft.cookieName, 'Cookie name'),
          ttl: cookieDuration(draft.cookieTtl),
        },
      },
    };
  if (draft.strategy === 'source-ip') return { consistentHash: { useSourceIp: true } };
  throw new Error('Unknown load-balancing strategy');
}
export function planLoadBalancer(
  spec: unknown,
  draft: LoadBalancerDraft
): { spec: Record<string, unknown> } {
  if (!isRecord(spec) || typeof spec.host !== 'string' || !spec.host || spec.host.length > 1024)
    throw new Error('Load-balancer editing requires an existing DestinationRule host');
  const change = loadBalancerChange(draft);
  if (change === undefined) throw new Error('Choose a load-balancer setting to set or remove');
  const original = editableObject(spec.trafficPolicy, 'traffic policy');
  const policy = { ...original };
  if (change === null) delete policy.loadBalancer;
  else {
    const value = editableObject(policy.loadBalancer, 'load-balancer configuration');
    if ('simple' in change) {
      delete value.consistentHash;
      value.simple = change.simple;
    } else {
      delete value.simple;
      const hash = editableObject(value.consistentHash, 'consistent-hash configuration');
      const cookie =
        'httpCookie' in change.consistentHash
          ? {
              ...editableObject(hash.httpCookie, 'affinity cookie'),
              ...change.consistentHash.httpCookie,
            }
          : undefined;
      const selectedKey =
        'httpCookie' in change.consistentHash
          ? 'httpCookie'
          : 'httpHeaderName' in change.consistentHash
          ? 'httpHeaderName'
          : 'useSourceIp';
      for (const key of ['httpHeaderName', 'httpCookie', 'useSourceIp', 'httpQueryParameterName'])
        if (key !== selectedKey) delete hash[key];
      Object.assign(hash, change.consistentHash);
      if (cookie) hash.httpCookie = cookie;
      value.consistentHash = hash;
    }
    policy.loadBalancer = value;
  }
  if (JSON.stringify(original) === JSON.stringify(policy))
    throw new Error('The load-balancer settings would not change');
  const next = { ...spec };
  if (Object.keys(policy).length) next.trafficPolicy = policy;
  else delete next.trafficPolicy;
  return { spec: next };
}
