import { editableObject, isRecord } from './object';

export const OUTBOUND_TLS_MODES = ['DISABLE', 'SIMPLE', 'MUTUAL', 'ISTIO_MUTUAL'] as const;
type TlsMode = (typeof OUTBOUND_TLS_MODES)[number];
export interface OutboundTlsDraft {
  action: 'keep' | 'set' | 'remove';
  mode: TlsMode | '';
  clientCertificate: string;
  privateKey: string;
  caCertificates: string;
}
export interface OutboundTlsChoice {
  mode: TlsMode;
  clientCertificate?: string;
  privateKey?: string;
  caCertificates?: string;
}
function tlsMode(value: unknown): value is TlsMode {
  return OUTBOUND_TLS_MODES.some(mode => mode === value);
}
export function initialOutboundTls(spec?: unknown): OutboundTlsDraft {
  const policy = isRecord(spec) && isRecord(spec.trafficPolicy) ? spec.trafficPolicy : {};
  const value = isRecord(policy.tls) ? policy.tls : {};
  return {
    action: 'keep',
    mode: tlsMode(value.mode) ? value.mode : '',
    clientCertificate: typeof value.clientCertificate === 'string' ? value.clientCertificate : '',
    privateKey: typeof value.privateKey === 'string' ? value.privateKey : '',
    caCertificates: typeof value.caCertificates === 'string' ? value.caCertificates : '',
  };
}
function filePath(value: string, field: string): string {
  if (
    typeof value !== 'string' ||
    value.length > 4096 ||
    !value.startsWith('/') ||
    value.endsWith('/') ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error(
      `${field} must be an absolute proxy-container file path, at most 4096 characters; do not enter certificate or key contents`
    );
  return value;
}
export function outboundTlsChange(draft: OutboundTlsDraft): OutboundTlsChoice | null | undefined {
  if (draft.action === 'keep') return undefined;
  if (draft.action === 'remove') return null;
  if (draft.action !== 'set') throw new Error('Unknown outbound TLS edit action');
  if (!tlsMode(draft.mode)) throw new Error('Choose an explicit outbound TLS mode');
  if (draft.mode === 'DISABLE' || draft.mode === 'ISTIO_MUTUAL') return { mode: draft.mode };
  return {
    mode: draft.mode,
    ...(draft.mode === 'MUTUAL'
      ? {
          clientCertificate: filePath(draft.clientCertificate, 'Client certificate'),
          privateKey: filePath(draft.privateKey, 'Private key'),
        }
      : {}),
    ...(draft.caCertificates
      ? { caCertificates: filePath(draft.caCertificates, 'CA certificates') }
      : {}),
  };
}
export function planOutboundTls(
  spec: unknown,
  draft: OutboundTlsDraft
): { spec: Record<string, unknown> } {
  if (!isRecord(spec) || typeof spec.host !== 'string' || !spec.host || spec.host.length > 1024)
    throw new Error('Outbound TLS editing requires an existing DestinationRule host');
  const change = outboundTlsChange(draft);
  if (change === undefined) throw new Error('Choose an outbound TLS setting to set or remove');
  const original = editableObject(spec.trafficPolicy, 'traffic policy');
  const policy = { ...original };
  if (change === null) delete policy.tls;
  else if (change.mode === 'DISABLE' || change.mode === 'ISTIO_MUTUAL') policy.tls = change;
  else {
    const tls = editableObject(policy.tls, 'outbound TLS configuration');
    delete tls.credentialName;
    for (const key of ['clientCertificate', 'privateKey', 'caCertificates'] as const) {
      if (change[key] === undefined) delete tls[key];
    }
    Object.assign(tls, change);
    policy.tls = tls;
  }
  if (JSON.stringify(original) === JSON.stringify(policy))
    throw new Error('The outbound TLS settings would not change');
  const next = { ...spec };
  if (Object.keys(policy).length) next.trafficPolicy = policy;
  else delete next.trafficPolicy;
  return { spec: next };
}
