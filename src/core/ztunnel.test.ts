import fixtureText from '../../test-files/diagnostics/ztunnel.json?raw';
import { ztunnelSnapshot } from './ztunnel';

it('projects source-bound registry fields without fabricating Kubernetes identities', () => {
  const result = ztunnelSnapshot(JSON.parse(fixtureText));
  expect(result.services).toHaveLength(3);
  expect(result.workloads).toHaveLength(3);
  expect(result.runtime).toEqual({
    clusterId: 'mesh-a',
    clusterDomain: 'example.test',
    network: '',
    node: 'node-a',
  });
  expect(result.services[0]).toMatchObject({
    addresses: ['network-a/192.0.2.1'],
    waypoint: { destination: 'bookinfo/waypoint.example.test', port: 15008 },
  });
  expect(result.services[0].endpoints?.filter(item => item.status === 'Healthy')).toHaveLength(1);
  expect(result.services[0].endpoints).toHaveLength(2);
  expect(result.services[1].endpoints).toEqual([]);
  expect(result.services[2].endpoints).toBeNull();
  expect(result.workloads[0].uid).toBe('mesh-a//Pod/bookinfo/reviews-a');
  expect(result.workloads[1].clusterId).toBe('mesh-b');
  expect(result.workloads[2]).toMatchObject({
    index: 3,
    name: null,
    uid: null,
    status: null,
    addresses: null,
  });
  expect(result.services[1].raw.futureField).toEqual({ enabled: false, count: 0 });
  expect(result.certificateCount).toBe(1);
  expect(result.policyCount).toBe(1);
  expect(JSON.stringify(result)).not.toContain('SYNTHETIC-CERTIFICATE-NOT-FOR-DISPLAY');
  expect(JSON.stringify(result)).not.toContain('SYNTHETIC-POLICY-BODY-NOT-FOR-DISPLAY');
});
it('keeps absent and empty collections distinct and repeated names as indexed observations', () => {
  const result = ztunnelSnapshot({
    services: [{ name: 'same' }, { name: 'same', endpoints: {} }],
    workloads: [{ uid: 'same' }, { uid: 'same' }],
    certificates: [],
  });
  expect(result.certificateCount).toBe(0);
  expect(result.policyCount).toBeNull();
  expect(result.services.map(item => [item.index, item.name, item.endpoints])).toEqual([
    [1, 'same', null],
    [2, 'same', []],
  ]);
  expect(result.workloads.map(item => item.index)).toEqual([1, 2]);
});
it.each([
  null,
  {},
  { configs: [] },
  { services: [] },
  { services: {}, workloads: [] },
  { services: [null], workloads: [] },
  { services: [], workloads: [null] },
  { services: [], workloads: [], config: false },
  { services: [], workloads: [], certificates: {} },
  { services: [{ endpoints: [] }], workloads: [] },
  { services: [{ endpoints: { a: false } }], workloads: [] },
  { services: [{ vips: [null] }], workloads: [] },
  { services: [], workloads: [{ status: true }] },
  { services: [], workloads: [{ waypoint: { hboneMtlsPort: 65536 } }] },
])('rejects malformed or wrong-format snapshots %#', value => {
  expect(() => ztunnelSnapshot(value)).toThrow();
});
it('enforces entity, endpoint and structural bounds', () => {
  expect(() => ztunnelSnapshot({ services: Array(1001).fill({}), workloads: [] })).toThrow('1000');
  const endpoints = Object.fromEntries(
    Array.from({ length: 1001 }, (_, index) => [String(index), {}])
  );
  expect(() => ztunnelSnapshot({ services: [{ endpoints }], workloads: [] })).toThrow('1000');
  const thousand = Object.fromEntries(
    Array.from({ length: 1000 }, (_, index) => [String(index), {}])
  );
  expect(() =>
    ztunnelSnapshot({ services: Array(11).fill({ endpoints: thousand }), workloads: [] })
  ).toThrow('10000');
  let deep: unknown = false;
  for (let i = 0; i < 65; i++) deep = { nested: deep };
  expect(() => ztunnelSnapshot({ services: [], workloads: [], extra: deep })).toThrow('64-level');
});
