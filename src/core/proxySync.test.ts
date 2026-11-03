import synczFixture from '../../test-files/diagnostics/syncz.json?raw';
import { proxySyncSnapshot, proxySynczPath } from './proxySync';

it('projects source-shaped Istiod SyncStatus records and preserves each sent/acked state', () => {
  const result = proxySyncSnapshot(JSON.parse(synczFixture));
  expect(result).toHaveLength(2);
  expect(result[0]).toMatchObject({
    proxy: 'reviews-v1-7d9c8b7b7f-q2m5k.bookinfo',
    clusterId: 'cluster-a',
    resources: [
      { name: 'CDS', sent: 'cds-4', acked: 'cds-4', state: 'synced' },
      { name: 'LDS', sent: 'lds-9', acked: 'lds-9', state: 'synced' },
      { name: 'RDS', sent: 'rds-2', acked: 'rds-2', state: 'synced' },
      { name: 'EDS', sent: 'eds-5', acked: 'eds-4', state: 'stale' },
      { name: 'ECDS', sent: 'ecds-1', acked: 'ecds-1', state: 'synced' },
      {
        name: 'networking.istio.io/VirtualService',
        sent: 'resource-18',
        acked: 'resource-18',
        sentTime: '2026-10-29T12:00:00Z',
        state: 'synced',
      },
    ],
  });
  expect(result[1].resources).toEqual([
    { name: 'CDS', sent: 'cds-7', acked: 'cds-6', state: 'stale' },
  ]);
});

it('rejects duplicate proxy identities rather than merging conflicting source rows', () => {
  expect(() =>
    proxySyncSnapshot([
      { proxy: 'reviews.bookinfo', cluster_id: 'a', cluster_sent: 'sent-a' },
      { proxy: 'reviews.bookinfo', cluster_id: 'b', cluster_sent: 'sent-b' },
    ])
  ).toThrow('conflicting proxy identities');
});

it.each([
  [null, 'records'],
  [Array.from({ length: 1001 }, () => ({ proxy: 'pod.ns' })), 'records'],
  [[{ proxy: '  ' }], 'identity'],
  [[{ proxy: 'pod.ns', cluster_sent: 4 }], 'sent version'],
  [[{ proxy: 'pod.ns', resources: { cds: { sentTime: 'not-a-time' } } }], 'sent time'],
  [[{ proxy: 'pod.ns', resources: ['invalid'] }], 'resources'],
])('rejects malformed or oversized synchronization evidence %#', (value, message) => {
  expect(() => proxySyncSnapshot(value)).toThrow(message);
});

it('builds a fixed Kubernetes Pod proxy path from a validated source target', () => {
  expect(proxySynczPath('istio-system', 'istiod-123', 8080)).toBe(
    '/api/v1/namespaces/istio-system/pods/istiod-123:8080/proxy/debug/syncz'
  );
  expect(() => proxySynczPath('istio-system', '../istiod', 8080)).toThrow();
  expect(() => proxySynczPath('istio-system', 'istiod-123', 0)).toThrow();
});
