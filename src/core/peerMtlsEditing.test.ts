import { initialPeerMtls, PEER_MTLS_MODES, planPeerMtls } from './peerMtlsEditing';

const spec = {
  selector: { matchLabels: { app: 'reviews' } },
  mtls: { mode: 'PERMISSIVE', extension: 'retained' },
  portLevelMtls: { '9080': { mode: 'DISABLE' } },
  extension: { retained: true },
};
it.each(PEER_MTLS_MODES)(
  'sets explicit %s without changing selector, workload-port overrides or unknown fields',
  mode => {
    const before = JSON.stringify(spec);
    if (mode === 'PERMISSIVE')
      expect(() => planPeerMtls(spec, { action: 'set', mode })).toThrow('would not change');
    else
      expect(planPeerMtls(spec, { action: 'set', mode }).spec).toEqual({
        ...spec,
        mtls: { mode, extension: 'retained' },
      });
    expect(JSON.stringify(spec)).toBe(before);
  }
);
it('distinguishes removing the entire top-level block from selecting explicit UNSET', () => {
  expect(planPeerMtls(spec, { action: 'remove', mode: '' }).spec).toEqual({
    selector: spec.selector,
    portLevelMtls: spec.portLevelMtls,
    extension: spec.extension,
  });
  expect(planPeerMtls({}, { action: 'set', mode: 'UNSET' }).spec).toEqual({
    mtls: { mode: 'UNSET' },
  });
  expect(() => planPeerMtls({}, { action: 'remove', mode: '' })).toThrow('would not change');
});
it('does not infer a mode or enable editing when the current block is absent or unknown', () => {
  for (const value of [
    undefined,
    {},
    { mtls: null },
    { mtls: {} },
    { mtls: { mode: 'unknown' } },
  ]) {
    expect(initialPeerMtls(value)).toEqual({ action: 'keep', mode: '' });
  }
  expect(initialPeerMtls(spec)).toEqual({ action: 'keep', mode: 'PERMISSIVE' });
  expect(() => planPeerMtls(spec, { action: 'keep', mode: 'STRICT' })).toThrow('Choose');
  expect(() => planPeerMtls(spec, { action: 'set', mode: '' })).toThrow('explicit');
  expect(() => planPeerMtls({ mtls: [] }, { action: 'set', mode: 'STRICT' })).toThrow('malformed');
  expect(() => planPeerMtls(null, { action: 'set', mode: 'STRICT' })).toThrow('unavailable');
});
