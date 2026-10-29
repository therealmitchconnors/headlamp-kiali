import { proxyServiceCandidate } from './proxyService';

const query = {
  name: 'outbound|9080|v1|reviews.bookinfo.svc.cluster.local',
  identityDomain: 'svc.cluster.local',
};
it('derives only a scoped outbound Service candidate, retaining subset text without claiming validation', () => {
  expect(proxyServiceCandidate(query)).toEqual({
    available: true,
    target: { namespace: 'bookinfo', name: 'reviews', port: 9080, subset: 'v1' },
  });
  expect(
    proxyServiceCandidate({
      ...query,
      name: 'outbound_|+09080_||reviews.bookinfo.svc.cluster.local',
    })
  ).toMatchObject({
    available: true,
    target: { port: 9080, subset: '' },
  });
  expect(
    proxyServiceCandidate({
      name: 'outbound|443||api.other.svc.example.test',
      identityDomain: 'svc.example.test',
    })
  ).toMatchObject({
    available: true,
    target: { namespace: 'other', name: 'api', port: 443 },
  });
});
it.each([
  [null, 'format'],
  ['PassthroughCluster', 'format'],
  ['outbound|9080||reviews.bookinfo.svc.cluster.local|extra', 'format'],
  ['inbound|9080||reviews.bookinfo.svc.cluster.local', 'direction'],
  ['outbound__|9080||reviews.bookinfo.svc.cluster.local', 'direction'],
  ['outbound|9080||reviews', 'host'],
  ['outbound|9080||reviews.bookinfo', 'host'],
  ['outbound|9080||reviews.bookinfo.svc', 'host'],
  ['outbound|9080||api.external.test', 'host'],
  ['outbound|9080||*.bookinfo.svc.cluster.local', 'host'],
  ['outbound|9080||Reviews.bookinfo.svc.cluster.local', 'host'],
  ['outbound|9080||reviews..svc.cluster.local', 'host'],
  ['outbound|9080||reviews.bookinfo.svc.cluster.local\n', 'host'],
  ['outbound|0||reviews.bookinfo.svc.cluster.local', 'port'],
  ['outbound|-1||reviews.bookinfo.svc.cluster.local', 'port'],
  ['outbound|65536||reviews.bookinfo.svc.cluster.local', 'port'],
  ['outbound|9223372036854775808||reviews.bookinfo.svc.cluster.local', 'port'],
  ['outbound|invalid||reviews.bookinfo.svc.cluster.local', 'port'],
] as const)('leaves %j explicitly ineligible (%s)', (name, reason) => {
  expect(proxyServiceCandidate({ ...query, name })).toEqual({ available: false, reason });
});
it('requires explicit DNS configuration and rejects malformed/oversized input', () => {
  expect(proxyServiceCandidate({ ...query, identityDomain: null })).toEqual({
    available: false,
    reason: 'domain',
  });
  expect(() => proxyServiceCandidate({ ...query, identityDomain: 'bad domain' })).toThrow();
  expect(() => proxyServiceCandidate({ ...query, name: 'x'.repeat(4097) })).toThrow('4096');
  const invalid = { ...query };
  Object.assign(invalid, { name: 1 });
  expect(() => proxyServiceCandidate(invalid)).toThrow('malformed');
});
