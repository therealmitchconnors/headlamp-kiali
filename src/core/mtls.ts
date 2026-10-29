/*
 * Port of Kiali v2.33.0 util/mtls/status.go and kubernetes/istio.go helpers.
 * These are configuration indicators, not observations of traffic encryption.
 */
import { filterByHost } from './hosts';
import { decodeLabelSelector, Labels, matchesSelector } from './labels';
import { isRecord } from './object';

export type PeerMode = 'UNSET' | 'DISABLE' | 'PERMISSIVE' | 'STRICT';
export type ClientTlsMode = 'DISABLE' | 'SIMPLE' | 'MUTUAL' | 'ISTIO_MUTUAL';

export function peerMtlsMode(value: unknown): PeerMode | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new Error('Invalid PeerAuthentication mTLS settings');
  const mode = value.mode ?? 'UNSET';
  if (mode !== 'UNSET' && mode !== 'DISABLE' && mode !== 'PERMISSIVE' && mode !== 'STRICT')
    throw new Error('Unknown PeerAuthentication mTLS mode');
  return mode;
}

/** Pinned checkers exclude any present selector, unlike the namespace indicator. */
export function checkerPeerMode(spec: Record<string, unknown>): PeerMode | undefined {
  if (spec.selector !== undefined && spec.selector !== null) {
    if (!isRecord(spec.selector) || Object.keys(spec.selector).some(key => key !== 'matchLabels'))
      throw new Error('Unsupported or malformed PeerAuthentication selector');
    decodeLabelSelector(spec.selector);
    return undefined;
  }
  return peerMtlsMode(spec.mtls);
}

export function clientTlsMode(value: unknown): ClientTlsMode | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new Error('Invalid DestinationRule TLS settings');
  const mode = value.mode ?? 'DISABLE';
  if (mode !== 'DISABLE' && mode !== 'SIMPLE' && mode !== 'MUTUAL' && mode !== 'ISTIO_MUTUAL')
    throw new Error('Unknown DestinationRule TLS mode');
  return mode;
}
export type MtlsIndicator =
  | 'MTLS_ENABLED'
  | 'MTLS_PARTIALLY_ENABLED'
  | 'MTLS_NOT_ENABLED'
  | 'MTLS_DISABLED';
export interface TlsStatus {
  destinationRuleStatus: string;
  peerAuthenticationStatus: string;
  overallStatus: MtlsIndicator | '';
}
export interface MtlsOptions {
  autoMtlsEnabled: boolean;
  allowPermissive: boolean;
}
export interface TlsPeerPolicy {
  name: string;
  namespace: string;
  mode?: PeerMode;
  selector?: Labels | null;
}
export interface TlsDestinationRule {
  name: string;
  namespace: string;
  host: string;
  mode?: ClientTlsMode;
}
export interface TlsService {
  name: string;
  namespace: string;
  selector?: Labels | null;
}
export interface MtlsPolicyInput extends MtlsOptions {
  peerAuthentications: readonly TlsPeerPolicy[];
  destinationRules: readonly TlsDestinationRule[];
}
export type NamespaceMtlsIndicator =
  | MtlsIndicator
  | 'UNSET'
  | 'UNSET_INHERITED_STRICT'
  | 'UNSET_INHERITED_DISABLED';
export interface NamespaceTlsAssessment {
  namespace: TlsStatus;
  mesh: TlsStatus;
  status: NamespaceMtlsIndicator;
}

export function assessNamespaceTls(
  namespace: string,
  rootNamespace: string,
  domain: string,
  input: MtlsPolicyInput
): NamespaceTlsAssessment {
  // Empty selectors are namespace-wide; the pinned low-level presence test is stricter.
  const wide = (name: string) =>
    input.peerAuthentications
      .filter(
        policy =>
          policy.namespace === name &&
          (policy.selector === undefined ||
            policy.selector === null ||
            Object.keys(policy.selector).length === 0)
      )
      .map(policy => ({ ...policy, selector: undefined }));
  const namespacePolicies = namespace === rootNamespace ? [] : wide(namespace);
  const meshPolicies = wide(rootNamespace);
  if (namespacePolicies.length > 1 || meshPolicies.length > 1)
    throw new Error(
      'Multiple namespace-wide PeerAuthentications require conflict resolution before assessment'
    );
  for (const host of ['*.local', `*.${namespace}.${domain}`]) {
    if (
      input.destinationRules.filter(rule => rule.host === host && rule.mode !== undefined).length >
      1
    )
      throw new Error(
        'Multiple matching wildcard DestinationRules require conflict resolution before assessment'
      );
  }
  const namespaceStatus = namespaceTlsStatus(namespace, domain, {
    ...input,
    peerAuthentications: namespacePolicies,
  });
  const mesh = meshTlsStatus({ ...input, peerAuthentications: meshPolicies });
  let status: NamespaceMtlsIndicator = namespaceStatus.overallStatus || 'UNSET';
  if (!namespacePolicies.some(policy => policy.mode !== undefined && policy.mode !== 'UNSET')) {
    status =
      namespace === rootNamespace
        ? mesh.overallStatus || 'UNSET'
        : mesh.overallStatus === 'MTLS_ENABLED'
        ? 'UNSET_INHERITED_STRICT'
        : mesh.overallStatus === 'MTLS_DISABLED'
        ? 'UNSET_INHERITED_DISABLED'
        : 'UNSET';
  }
  return { namespace: namespaceStatus, mesh, status };
}
const EMPTY: TlsStatus = {
  destinationRuleStatus: '',
  peerAuthenticationStatus: '',
  overallStatus: '',
};

export function configuredTlsStatus(dr: string, pa: string, options: MtlsOptions): TlsStatus {
  let overallStatus: MtlsIndicator = 'MTLS_PARTIALLY_ENABLED';
  const enabled =
    dr === 'ISTIO_MUTUAL' || dr === 'MUTUAL' || (dr === '' && options.autoMtlsEnabled);
  const disabled = dr === 'DISABLE' || (dr === '' && options.autoMtlsEnabled);
  if ((pa === 'STRICT' || (pa === 'PERMISSIVE' && options.allowPermissive)) && enabled)
    overallStatus = 'MTLS_ENABLED';
  else if (pa === 'DISABLE' && disabled) overallStatus = 'MTLS_DISABLED';
  else if (pa === '' && dr === '') overallStatus = 'MTLS_NOT_ENABLED';
  return { destinationRuleStatus: dr, peerAuthenticationStatus: pa, overallStatus };
}

export function overallTlsStatus(
  namespace: TlsStatus,
  mesh: TlsStatus,
  options: MtlsOptions
): MtlsIndicator {
  const defined = (value: TlsStatus) =>
    value.overallStatus === 'MTLS_ENABLED' || value.overallStatus === 'MTLS_DISABLED';
  if (defined(namespace))
    return namespace.overallStatus === 'MTLS_ENABLED' ? 'MTLS_ENABLED' : 'MTLS_DISABLED';
  if (namespace.overallStatus === 'MTLS_PARTIALLY_ENABLED') {
    return overallTlsStatus(
      EMPTY,
      configuredTlsStatus(
        namespace.destinationRuleStatus || mesh.destinationRuleStatus,
        namespace.peerAuthenticationStatus || mesh.peerAuthenticationStatus,
        options
      ),
      options
    );
  }
  if (defined(mesh))
    return mesh.overallStatus === 'MTLS_ENABLED' ? 'MTLS_ENABLED' : 'MTLS_DISABLED';
  const dr = mesh.destinationRuleStatus;
  const pa = mesh.peerAuthenticationStatus;
  if (!pa && !dr) return 'MTLS_NOT_ENABLED';
  if ((pa === 'DISABLE' && !dr) || (dr === 'DISABLE' && !pa)) return 'MTLS_DISABLED';
  if (
    options.autoMtlsEnabled &&
    ((pa === 'STRICT' && !dr) ||
      (['ISTIO_MUTUAL', 'MUTUAL'].includes(dr) && !pa) ||
      (options.allowPermissive && pa === 'PERMISSIVE' && !dr))
  )
    return 'MTLS_ENABLED';
  return 'MTLS_PARTIALLY_ENABLED';
}

function globalPeerMode(policies: readonly TlsPeerPolicy[]): string {
  // The pinned low-level helper skips every explicitly present selector, including {}.
  return (
    policies.find(
      policy =>
        (policy.selector === undefined || policy.selector === null) && policy.mode !== undefined
    )?.mode ?? ''
  );
}

export function namespaceTlsStatus(
  namespace: string,
  domain: string,
  input: MtlsPolicyInput
): TlsStatus {
  const dr =
    input.destinationRules.find(
      rule => rule.host === `*.${namespace}.${domain}` && rule.mode !== undefined
    )?.mode ?? '';
  return configuredTlsStatus(dr, globalPeerMode(input.peerAuthentications), input);
}

export function meshTlsStatus(input: MtlsPolicyInput): TlsStatus {
  const dr =
    input.destinationRules.find(rule => rule.host === '*.local' && rule.mode !== undefined)?.mode ??
    '';
  const status = configuredTlsStatus(dr, globalPeerMode(input.peerAuthentications), input);
  return { ...status, overallStatus: overallTlsStatus(EMPTY, status, input) };
}

/** Callers supply policies scoped to the workload namespace, preserving upstream order. */
export function workloadTlsStatus(
  namespace: string,
  domain: string,
  input: MtlsPolicyInput & {
    matchingLabels: Labels;
    services: readonly TlsService[];
  }
): MtlsIndicator {
  for (const policy of input.peerAuthentications) {
    if (
      !policy.selector ||
      !Object.keys(policy.selector).length ||
      !matchesSelector(input.matchingLabels, { matchLabels: policy.selector })
    )
      continue;
    if (policy.mode === 'STRICT') return 'MTLS_ENABLED';
    if (policy.mode === 'DISABLE') return 'MTLS_DISABLED';
    if (policy.mode !== 'PERMISSIVE') continue;
    for (const service of input.services) {
      if (
        service.namespace !== namespace ||
        !service.selector ||
        !Object.keys(service.selector).length ||
        !matchesSelector(service.selector, { matchLabels: policy.selector })
      )
        continue;
      for (const rule of input.destinationRules) {
        if (!filterByHost(rule.host, rule.namespace, service.name, service.namespace, domain))
          continue;
        if (rule.mode === 'ISTIO_MUTUAL' || rule.mode === 'MUTUAL') return 'MTLS_ENABLED';
        if (rule.mode === 'DISABLE') return 'MTLS_DISABLED';
      }
    }
    return 'MTLS_NOT_ENABLED';
  }
  return 'MTLS_NOT_ENABLED';
}
