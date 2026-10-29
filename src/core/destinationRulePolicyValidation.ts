import { validateIdentityDomain } from './config';
import { validationMeshRoot } from './mesh';
import { checkerPeerMode, clientTlsMode } from './mtls';
import { isDnsLabel, isDnsSubdomain, isRecord } from './object';
import type {
  ReferenceValidationContext,
  ValidationOwner,
  ValidationRecord,
} from './referenceValidation';
import type { Finding } from './validation';
import {
  configurationExportIncluded,
  configurationExports,
  namespacedValidationRecords,
} from './validationScope';

const messages = {
  KIA0205: 'PeerAuthentication enabling mTLS at mesh level is missing',
  KIA0206: 'PeerAuthentication enabling namespace-wide mTLS is missing',
  KIA0207: 'PeerAuthentication with TLS strict mode found, it should be permissive',
  KIA0208: 'PeerAuthentication enabling mTLS found, permissive mode needed',
};
function fields(spec: Record<string, unknown>) {
  if (typeof spec.host !== 'string' || !spec.host || spec.host.length > 1024)
    throw new Error(
      'DestinationRule policy checks require a nonempty host of at most 1024 characters'
    );
  const policy = spec.trafficPolicy;
  if (policy !== undefined && policy !== null && !isRecord(policy))
    throw new Error('Invalid DestinationRule traffic policy');
  return {
    host: spec.host,
    mode: clientTlsMode(isRecord(policy) ? policy.tls : undefined),
    exportTo: configurationExports(spec),
  };
}
export function destinationRuleNeedsPeerPolicies(
  kind: string,
  group: string,
  namespace: string,
  spec: unknown,
  domain: string | null
) {
  if (
    kind !== 'DestinationRule' ||
    group !== 'networking.istio.io' ||
    !isRecord(spec) ||
    !isRecord(spec.trafficPolicy) ||
    !isRecord(spec.trafficPolicy.tls)
  )
    return false;
  const mode = spec.trafficPolicy.tls.mode;
  return (
    (mode === undefined || mode === null || mode === 'DISABLE' || mode === 'ISTIO_MUTUAL') &&
    (spec.host === '*.local' ||
      (!!namespace && !!domain && spec.host === `*.${namespace}.${domain}`))
  );
}
export function destinationRulePolicyChecks(
  kind: string,
  group: string,
  namespace: string,
  spec: Record<string, unknown>,
  context?: ReferenceValidationContext,
  owner?: ValidationOwner
): { findings: Finding[]; skipped: string[] } {
  const findings: Finding[] = [];
    const skipped: string[] = [];
  if (kind !== 'DestinationRule' || group !== 'networking.istio.io') return { findings, skipped };
  try {
    const target = fields(spec);
    if (target.mode !== 'DISABLE' && target.mode !== 'ISTIO_MUTUAL') return { findings, skipped };
    if (!isDnsLabel(namespace))
      throw new Error('DestinationRule policy checks require an explicit namespace');
    const meshWide = target.host === '*.local';
    if (!meshWide) {
      if (!target.host.startsWith(`*.${namespace}.`)) return { findings, skipped };
      if (!context?.identityDomain)
        throw new Error(
          'Namespace-wide DestinationRule policy checks require an explicit Service DNS identity domain'
        );
      if (target.host !== `*.${namespace}.${validateIdentityDomain(context.identityDomain)}`)
        return { findings, skipped };
    }
    const mesh = context?.namespaceMesh?.get(namespace);
    if (mesh?.status !== 'ready')
      throw new Error(
        mesh?.status === 'unavailable'
          ? mesh.message
          : 'DestinationRule policy checks require resolved namespace mesh configuration'
      );
    if (target.mode === 'ISTIO_MUTUAL' && (mesh.fields.enableAutoMtls ?? true))
      return { findings, skipped };
    const root = validationMeshRoot(mesh);
    if (
      !context?.namespaces.complete ||
      !context.destinationRules.complete ||
      !context.peerAuthentications?.complete
    )
      throw new Error(
        'DestinationRule policy checks require complete Namespace, DestinationRule and PeerAuthentication lists'
      );
    if (
      context.namespaces.items.length > 1000 ||
      !context.namespaces.items.some(item => item.name === namespace)
    )
      throw new Error('DestinationRule policy namespace evidence is missing or oversized');
    if (!owner || !isDnsSubdomain(owner.name) || !owner.uid)
      throw new Error('DestinationRule policy checks require the captured name and UID');
    const rules = namespacedValidationRecords(context.destinationRules.items);
    const selected = rules.find(
      record => record.name === owner.name && record.namespace === namespace
    );
    if (
      !selected ||
      selected.uid !== owner.uid ||
      JSON.stringify(fields(selected.spec)) !== JSON.stringify(target)
    )
      throw new Error(
        'DestinationRule identity or policy settings changed; reload before checking mTLS'
      );
    if (!configurationExportIncluded('DestinationRule', selected, namespace, context))
      throw new Error('Selected DestinationRule is not exported into this namespace policy scope');
    const peers = namespacedValidationRecords(context.peerAuthentications.items)
      .filter(record => record.namespace === namespace || record.namespace === root)
      .map(record => ({ record, mode: checkerPeerMode(record.spec) }));
    const local = peers.filter(peer => peer.record.namespace === namespace);
    const global = peers.filter(peer => peer.record.namespace === root);
    const add = (code: keyof typeof messages, reference?: ValidationRecord) => {
      findings.push({
        code,
        severity: 'error',
        path: 'spec/trafficPolicy/tls/mode',
        message: messages[code],
        ...(reference?.uid
          ? {
              references: [
                {
                  kind: 'PeerAuthentication' as const,
                  group: 'security.istio.io' as const,
                  name: reference.name,
                  namespace: reference.namespace,
                  uid: reference.uid,
                },
              ],
            }
          : {}),
      });
    };
    if (target.mode === 'ISTIO_MUTUAL') {
      const candidates = meshWide ? global : [...local, ...global];
      if (!candidates.some(peer => peer.mode === 'STRICT' || peer.mode === 'PERMISSIVE'))
        add(meshWide ? 'KIA0205' : 'KIA0206');
    } else if (meshWide) {
      const strict = global.find(peer => peer.mode === 'STRICT');
      if (strict) add('KIA0208', strict.record);
    } else {
      let disabled = false;
      for (const peer of local) {
        if (peer.mode === 'STRICT') {
          add('KIA0207', peer.record);
          return { findings, skipped };
        }
        if (peer.mode === 'PERMISSIVE') return { findings, skipped };
        if (peer.mode === 'DISABLE') disabled = true;
      }
      if (!disabled) {
        const strict = global.find(peer => peer.mode === 'STRICT');
        if (strict) add('KIA0208', strict.record);
      }
    }
  } catch (error) {
    skipped.push(
      error instanceof Error ? error.message : 'Unable to evaluate DestinationRule peer policies'
    );
  }
  return { findings, skipped };
}
