import { PeerMode } from './mtls';
import { editableObject, isRecord } from './object';

export const PEER_MTLS_MODES = ['UNSET', 'DISABLE', 'PERMISSIVE', 'STRICT'] as const;
export interface PeerMtlsDraft {
  action: 'keep' | 'set' | 'remove';
  mode: PeerMode | '';
}
export function initialPeerMtls(spec: unknown): PeerMtlsDraft {
  const mtls = isRecord(spec) && isRecord(spec.mtls) ? spec.mtls : {};
  return { action: 'keep', mode: PEER_MTLS_MODES.find(mode => mode === mtls.mode) ?? '' };
}
export function planPeerMtls(
  spec: unknown,
  draft: PeerMtlsDraft
): { spec: Record<string, unknown> } {
  if (!isRecord(spec)) throw new Error('The PeerAuthentication specification is unavailable');
  if (draft.action !== 'set' && draft.action !== 'remove')
    throw new Error('Choose to set or remove the inbound mTLS policy');
  const next = { ...spec };
  if (draft.action === 'remove') delete next.mtls;
  else {
    const mode = PEER_MTLS_MODES.find(mode => mode === draft.mode);
    if (!mode) throw new Error('Choose an explicit inbound mTLS mode');
    next.mtls = { ...editableObject(spec.mtls, 'inbound mTLS policy'), mode };
  }
  if (JSON.stringify(next) === JSON.stringify(spec))
    throw new Error('The inbound mTLS settings would not change');
  return { spec: next };
}
