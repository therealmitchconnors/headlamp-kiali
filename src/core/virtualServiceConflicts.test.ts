import oracleText from '../../test-files/parity/virtual-service-conflict-oracle.json?raw';
import {
  ReferenceValidationContext,
  referenceValidationSources,
  ValidationRecord,
} from './referenceValidation';
import { initialValidation } from './validation';
import {
  virtualServiceConflictChecks,
  virtualServiceHostConflicts,
} from './virtualServiceConflicts';

const oracle: {
  cases: {
    input: {
      records: Pick<ValidationRecord, 'name' | 'namespace' | 'spec'>[];
      namespaces: string[];
      domain: string;
    };
    expected: { conflict: boolean; references: number[] }[];
  }[];
} = JSON.parse(oracleText);
it.each(oracle.cases)('matches original Go VirtualService grouping %#', ({ input, expected }) => {
  input.records.forEach((_record, index) => {
    expect(
      virtualServiceHostConflicts(input.records, input.namespaces, input.domain, index)
    ).toEqual(expected[index]);
  });
});
const spec = { hosts: ['reviews'], exportTo: ['*'] };
const record = (
  name: string,
  namespace: string,
  spec: Record<string, unknown> = {}
): ValidationRecord => ({ name, namespace, uid: `${namespace}-${name}`, labels: {}, spec });
const context = (): ReferenceValidationContext => ({
  cluster: 'alpha',
  identityDomain: 'svc.cluster.local',
  namespaces: { complete: true, items: [record('bookinfo', ''), record('other', '')] },
  sidecars: { complete: true, items: [] },
  destinationRules: { complete: false, items: [] },
  virtualServices: {
    complete: true,
    items: [
      record('selected', 'bookinfo', spec),
      record('peer', 'other', { ...spec, hosts: ['reviews.bookinfo'] }),
    ],
  },
});
const owner = { name: 'selected', uid: 'bookinfo-selected' };
const check = (value = context(), target: Record<string, unknown> = spec) =>
  virtualServiceConflictChecks(
    'VirtualService',
    'networking.istio.io',
    'bookinfo',
    target,
    value,
    owner
  );
it('retains the warning path and observed peer identity', () => {
  expect(check()).toEqual({
    skipped: [],
    findings: [
      {
        code: 'KIA1106',
        severity: 'warning',
        path: 'spec/hosts',
        message: 'More than one Virtual Service for same host',
        references: [
          {
            kind: 'VirtualService',
            group: 'networking.istio.io',
            namespace: 'other',
            name: 'peer',
            uid: 'other-peer',
          },
        ],
      },
    ],
  });
  const result = initialValidation({
    cluster: 'alpha',
    namespace: 'bookinfo',
    kind: 'VirtualService',
    spec,
    owner,
    context: context(),
    workloads: [],
    complete: false,
    annotations: { 'kiali.io/ignore-validations': 'KIA1106' },
  });
  expect(result.suppressed).toBe(1);
  expect(result.findings).toEqual([]);
});
it('requests only the conflict prerequisites for host-only specifications', () => {
  expect(
    referenceValidationSources(
      'VirtualService',
      'networking.istio.io',
      spec,
      'svc.cluster.local',
      'bookinfo'
    )
  ).toEqual(['namespaces', 'virtualServices', 'sidecars']);
  expect(
    referenceValidationSources('VirtualService', 'networking.istio.io', spec, null, 'bookinfo')
  ).toEqual(['namespaces']);
  expect(check({ ...context(), identityDomain: null }).skipped[0]).toContain(
    'explicit Service DNS'
  );
  expect(virtualServiceConflictChecks('Other', 'networking.istio.io', '', spec)).toEqual({
    findings: [],
    skipped: [],
  });
  expect(check(context(), { hosts: [] })).toEqual({ findings: [], skipped: [] });
});
it.each(['namespaces', 'sidecars', 'virtualServices'] as const)(
  'defers incomplete %s evidence',
  key => {
    const value = context();
    value[key] = { complete: false, items: [] };
    expect(check(value).findings).toEqual([]);
    expect(check(value).skipped[0]).toContain('complete bounded');
  }
);
it.each(['uid', 'hosts', 'gateways', 'exportTo', 'missing', 'duplicate'])(
  'defers stale or ambiguous %s',
  field => {
    const value = context();
    const items = [...value.virtualServices!.items];
    if (field === 'uid') items[0] = { ...items[0], uid: 'replacement' };
    else if (field === 'missing') items.shift();
    else if (field === 'duplicate') items.push({ ...items[0] });
    else items[0] = { ...items[0], spec: { ...spec, [field]: ['changed'] } };
    value.virtualServices = { complete: true, items };
    expect(check(value).findings).toEqual([]);
    expect(check(value).skipped).toHaveLength(1);
  }
);
it('uses per-kind export defaults and excludes generated and ambient remote peers', () => {
  const value = context();
  const peer = value.virtualServices!.items[1];
  peer.spec = { hosts: ['reviews.bookinfo'] };
  expect(check(value).skipped[0]).toContain('export defaults are unresolved');
  value.namespaceMesh = new Map([
    [
      'other',
      {
        status: 'ready',
        controller: 'istiod',
        fields: {
          hasDiscoverySelectors: false,
          defaultVirtualServiceExportTo: ['.'],
          defaultServiceExportTo: ['*'],
        },
      },
    ],
  ]);
  expect(check(value).findings).toEqual([]);
  peer.spec = { ...peer.spec, exportTo: ['*'] };
  expect(check(value).findings).toHaveLength(1);
  peer.name = 'peer-autogenerated-k8s';
  expect(check(value).findings).toEqual([]);
  peer.name = 'peer';
  value.namespaces.items[1].labels = { 'istio.io/dataplane-mode': 'ambient' };
  expect(check(value).findings).toEqual([]);
});
it('imports entire VirtualServices once any host is imported', () => {
  const value = context();
  const target = { hosts: ['allowed', 'reviews'], exportTo: ['*'] };
  value.virtualServices!.items[0].spec = target;
  value.virtualServices!.items[1].spec = {
    hosts: ['other-allowed', 'reviews.bookinfo'],
    exportTo: ['*'],
  };
  value.sidecars.items = [
    record('local', 'bookinfo', {
      egress: [{ hosts: ['bookinfo/allowed', 'other/other-allowed'] }],
    }),
  ];
  // Both objects are imported through one host; the other host still contributes.
  expect(check(value, target).findings).toHaveLength(1);
  value.virtualServices!.items[1].spec = { hosts: ['reviews.bookinfo'], exportTo: ['*'] };
  expect(check(value, target).findings).toEqual([]);
  value.sidecars.items = [
    record('local', 'bookinfo', { egress: [{ hosts: ['bookinfo/missing'] }] }),
  ];
  expect(check(value, target).skipped[0]).toContain('not exported and imported');
});
it('requires known root scope for a namespace-wide fallback but ignores workload overrides', () => {
  const value = context();
  value.sidecars.items = [record('root', 'other', { egress: [{ hosts: ['*/*'] }] })];
  expect(check(value).skipped[0]).toContain('resolved mesh root');
  value.sidecars.items = [
    record('workload', 'other', {
      workloadSelector: { labels: { app: 'reviews' } },
      egress: [{ hosts: ['other/*'] }],
    }),
  ];
  expect(check(value).findings).toHaveLength(1);
});
it.each([
  {},
  { hosts: [false] },
  { hosts: ['x'.repeat(1025)] },
  { hosts: Array(101).fill('reviews') },
  { hosts: ['reviews'], gateways: Array(101).fill('mesh') },
  { hosts: ['reviews'], exportTo: {} },
])('handles missing and malformed fields without claiming a conflict %#', target => {
  const result = check(context(), target);
  expect(result.findings).toEqual([]);
  if ('hosts' in target) expect(result.skipped).toHaveLength(1);
});
it('bounds gateway-host expansion at exactly 20000 contributions', () => {
  const many = { hosts: Array(100).fill('reviews'), gateways: Array(100).fill('mesh') };
  const records = [record('a', 'bookinfo', many), record('b', 'bookinfo', many)];
  expect(virtualServiceHostConflicts(records, ['bookinfo'], 'svc.cluster.local', 0)).toEqual({
    conflict: true,
    references: [1],
  });
  expect(() =>
    virtualServiceHostConflicts(
      [...records, record('c', 'bookinfo', spec)],
      ['bookinfo'],
      'svc.cluster.local',
      0
    )
  ).toThrow('20000');
  expect(() =>
    virtualServiceHostConflicts(Array(1001).fill(records[0]), [], 'svc.cluster.local', 0)
  ).toThrow('bounded records');
});
