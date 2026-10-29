import { validateIdentityDomain } from './config';
import { validationMeshRoot } from './mesh';
import { checkerPeerMode, clientTlsMode } from './mtls';
import { isDnsLabel, isRecord } from './object';
import type { ReferenceValidationContext, ValidationRecord } from './referenceValidation';
import type { Finding } from './validation';
import { configurationExportIncluded, namespacedValidationRecords } from './validationScope';

const messages = {
  KIA0401: 'Mesh-wide Destination Rule enabling mTLS is missing',
  KIA0501: 'Destination Rule enabling namespace-wide mTLS is missing',
  KIA0505: 'Destination Rule disabling namespace-wide mTLS is missing',
  KIA0506: 'Destination Rule disabling mesh-wide mTLS is missing',
};

export function peerAuthenticationNeedsContext(kind: string, group: string, spec: unknown) {
  return (
    kind === 'PeerAuthentication' &&
    group === 'security.istio.io' &&
    isRecord(spec) &&
    (spec.selector === undefined || spec.selector === null) &&
    isRecord(spec.mtls) &&
    (spec.mtls.mode === 'STRICT' || spec.mtls.mode === 'DISABLE')
  );
}

export function peerAuthenticationChecks(
  kind: string,
  group: string,
  namespace: string,
  spec: Record<string, unknown>,
  context?: ReferenceValidationContext
): { findings: Finding[]; skipped: string[] } {
  const findings: Finding[] = [];
  const skipped: string[] = [];
  if (kind !== 'PeerAuthentication' || group !== 'security.istio.io') return { findings, skipped };
  try {
    const mode = checkerPeerMode(spec);
    if (mode !== 'STRICT' && mode !== 'DISABLE') return { findings, skipped };
    if (!isDnsLabel(namespace))
      throw new Error('PeerAuthentication checks require an explicit valid namespace');
    const mesh = context?.namespaceMesh?.get(namespace);
    if (mesh?.status !== 'ready')
      throw new Error(
        mesh?.status === 'unavailable'
          ? mesh.message
          : 'PeerAuthentication checks require resolved namespace mesh configuration'
      );
    if (mode === 'STRICT' && (mesh.fields.enableAutoMtls ?? true)) return { findings, skipped };
    const root = validationMeshRoot(mesh);
    const meshWide = namespace === root;
    if (!meshWide && !context?.identityDomain)
      throw new Error(
        'Namespace-wide PeerAuthentication checks require an explicit Service DNS identity domain'
      );
    const domain = meshWide ? '' : validateIdentityDomain(context?.identityDomain);
    if (!context?.namespaces.complete || !context.destinationRules.complete)
      throw new Error(
        'PeerAuthentication checks require complete Namespace and DestinationRule lists'
      );
    if (
      context.namespaces.items.length > 1000 ||
      !context.namespaces.items.some(item => item.name === namespace)
    )
      throw new Error('PeerAuthentication namespace evidence is missing or oversized');
    const namespaceHost = `*.${namespace}.${domain}`;
    const rules = namespacedValidationRecords(context.destinationRules.items).flatMap(record => {
      if (typeof record.spec.host !== 'string' || record.spec.host.length > 1024)
        throw new Error('Invalid DestinationRule host in PeerAuthentication context');
      if (record.spec.host !== '*.local' && (meshWide || record.spec.host !== namespaceHost))
        return [];
      if (!configurationExportIncluded('DestinationRule', record, namespace, context)) return [];
      const policy = record.spec.trafficPolicy;
      if (policy !== undefined && policy !== null && !isRecord(policy))
        throw new Error('Invalid DestinationRule traffic policy');
      return [
        {
          record,
          host: record.spec.host,
          mode: clientTlsMode(isRecord(policy) ? policy.tls : undefined),
        },
      ];
    });
    const add = (code: keyof typeof messages, reference?: ValidationRecord) => {
      findings.push({
        code,
        severity: 'error',
        path: 'spec/mtls',
        message: messages[code],
        ...(reference?.uid
          ? {
              references: [
                {
                  kind: 'DestinationRule' as const,
                  group: 'networking.istio.io' as const,
                  name: reference.name,
                  namespace: reference.namespace,
                  uid: reference.uid,
                },
              ],
            }
          : {}),
      });
    };
    if (mode === 'STRICT') {
      if (!rules.some(rule => rule.mode === 'ISTIO_MUTUAL')) add(meshWide ? 'KIA0401' : 'KIA0501');
    } else if (meshWide) {
      const enabled = rules.find(rule => rule.mode === 'MUTUAL' || rule.mode === 'ISTIO_MUTUAL');
      if (enabled) add('KIA0506', enabled.record);
    } else {
      let meshEnabled: ValidationRecord | undefined;
      for (const rule of rules) {
        if (rule.host === namespaceHost) {
          if (rule.mode === 'MUTUAL' || rule.mode === 'ISTIO_MUTUAL') {
            add('KIA0505', rule.record);
            return { findings, skipped };
          }
          if (rule.mode === 'DISABLE') return { findings, skipped };
        } else if (rule.mode === 'MUTUAL' || rule.mode === 'ISTIO_MUTUAL') {
          meshEnabled ??= rule.record;
        }
      }
      if (meshEnabled) add('KIA0505', meshEnabled);
    }
  } catch (error) {
    skipped.push(
      error instanceof Error ? error.message : 'Unable to evaluate PeerAuthentication configuration'
    );
  }
  return { findings, skipped };
}
