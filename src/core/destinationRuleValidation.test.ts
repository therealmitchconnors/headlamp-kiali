import oracleText from '../../test-files/parity/destination-rule-oracle.json?raw';
import {
  destinationDefaultMtls,
  destinationHostsOverlap,
  destinationRuleChecks,
  destinationRuleConflictPairs,
} from './destinationRuleValidation';
import {
  ReferenceValidationContext,
  referenceValidationSources,
  ValidationRecord,
} from './referenceValidation';
import { initialValidation } from './validation';
const fixtures: {
  cases: {
    input: {
      domain: string;
      namespaces: string[];
      records: Pick<ValidationRecord, 'name' | 'namespace' | 'spec'>[];
    };
    expected: [number, number][];
  }[];
} = JSON.parse(oracleText);
it.each(fixtures.cases)(
  'matches original Go DestinationRule conflicts %#',
  ({ input, expected }) => {
    const order = (pairs: [number, number][]) => pairs.sort(([a, b], [c, d]) => a - c || b - d);
    expect(
      order(destinationRuleConflictPairs(input.records, input.namespaces, input.domain))
    ).toEqual(expected);
    input.records.forEach((_record, index) => {
      expect(
        order(destinationRuleConflictPairs(input.records, input.namespaces, input.domain, index))
      ).toEqual(expected.filter(pair => pair.includes(index)));
    });
  }
);
const spec = { host: 'reviews', subsets: [{ name: 'v1' }], exportTo: ['*'] };
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
  destinationRules: {
    complete: true,
    items: [
      record('selected', 'bookinfo', spec),
      record('peer', 'other', { ...spec, host: 'reviews.bookinfo' }),
    ],
  },
});
const owner = { name: 'selected', uid: 'bookinfo-selected' };
const check = (value = context(), selected: Record<string, unknown> = spec) =>
  destinationRuleChecks(
    'DestinationRule',
    'networking.istio.io',
    'bookinfo',
    selected,
    value,
    owner
  );
it('preserves host/subset identities and scoped related object references', () => {
  expect(check()).toEqual({
    skipped: [],
    findings: [
      {
        code: 'KIA0201',
        severity: 'warning',
        path: 'spec/host',
        message: 'More than one DestinationRules for the same host subset combination',
        references: [
          {
            kind: 'DestinationRule',
            group: 'networking.istio.io',
            name: 'peer',
            namespace: 'other',
            uid: 'other-peer',
          },
        ],
      },
    ],
  });
  const result = initialValidation({
    cluster: 'alpha',
    namespace: 'bookinfo',
    kind: 'DestinationRule',
    spec,
    owner,
    context: context(),
    workloads: [],
    complete: false,
    annotations: { 'kiali.io/ignore-validations': 'KIA0201' },
  });
  expect(result.suppressed).toBe(1);
  expect(result.findings).toEqual([]);
});
it('honors private exports, explicit mesh defaults and namespace-wide imports', () => {
  const value = context();
  value.destinationRules.items[1].spec = { ...spec, host: 'reviews.bookinfo', exportTo: ['.'] };
  expect(check(value).findings).toEqual([]);
  value.destinationRules.items[1].spec = { host: 'reviews.bookinfo', subsets: spec.subsets };
  expect(check(value).skipped[0]).toContain('export defaults are unresolved');
  value.namespaceMesh = new Map([
    [
      'other',
      {
        status: 'ready',
        controller: 'istiod',
        fields: { hasDiscoverySelectors: false, defaultDestinationRuleExportTo: ['*'] },
      },
    ],
  ]);
  expect(check(value).findings).toHaveLength(1);
  value.sidecars.items = [record('local', 'bookinfo', { egress: [{ hosts: ['other/*'] }] })];
  expect(check(value).findings).toEqual([]);
  expect(check(value).skipped[0]).toContain('not exported and imported');
});
it('keeps wildcard suffix boundaries and exact non-local ISTIO_MUTUAL defaults', () => {
  expect(destinationHostsOverlap('*.bookinfo.svc.cluster.local', '*.other.svc.cluster.local')).toBe(
    false
  );
  expect(
    destinationHostsOverlap('reviews.other.svc.cluster.local', '*.other.svc.cluster.local')
  ).toBe(true);
  expect(
    destinationDefaultMtls(
      'bookinfo',
      '*.bookinfo.svc.cluster.local',
      'ISTIO_MUTUAL',
      'svc.cluster.local'
    )
  ).toBe(true);
  expect(
    destinationDefaultMtls(
      'bookinfo',
      '*.other.svc.cluster.local',
      'ISTIO_MUTUAL',
      'svc.cluster.local'
    )
  ).toBe(false);
  expect(destinationDefaultMtls('bookinfo', '*.local', 'MUTUAL', 'svc.cluster.local')).toBe(false);
  expect(
    check(context(), {
      host: '*.bookinfo.svc.cluster.local',
      trafficPolicy: { tls: { mode: 'ISTIO_MUTUAL' } },
    }).findings
  ).toEqual([]);
});
it.each(['domain', 'partial', 'uid', 'spec', 'namespace', 'duplicate', 'mode'])(
  'defers %s evidence without inventing a conflict',
  reason => {
    const value = context();
    if (reason === 'domain') value.identityDomain = null;
    if (reason === 'partial') value.destinationRules.complete = false;
    if (reason === 'uid') value.destinationRules.items[0].uid = 'replacement';
    if (reason === 'spec')
      value.destinationRules.items[0].spec = { ...spec, subsets: [{ name: 'v2' }] };
    if (reason === 'namespace') value.namespaces.items = [record('bookinfo', '')];
    if (reason === 'duplicate')
      value.destinationRules.items = [
        value.destinationRules.items[0],
        value.destinationRules.items[0],
      ];
    if (reason === 'mode')
      value.destinationRules.items[1].spec = {
        ...spec,
        trafficPolicy: { tls: { mode: 'UNRECOGNIZED' } },
      };
    const result = check(value);
    expect(result.findings).toEqual([]);
    expect(result.skipped.length).toBeGreaterThan(0);
  }
);
it('bounds all-rule and selected-owner work without truncating results silently', () => {
  const many = Array.from({ length: 1000 }, (_, index) =>
    record(`rule-${index}`, 'bookinfo', { host: `service-${index}` })
  );
  expect(destinationRuleConflictPairs(many, ['bookinfo'], 'svc.cluster.local', 500)).toEqual([]);
  expect(() => destinationRuleConflictPairs(many, ['bookinfo'], 'svc.cluster.local')).toThrow(
    '20000'
  );
  expect(() =>
    destinationRuleConflictPairs([...many, many[0]], ['bookinfo'], 'svc.cluster.local', 0)
  ).toThrow('bounded');
  expect(() =>
    destinationRuleConflictPairs(
      [
        record('one', 'bookinfo', {
          host: 'reviews',
          subsets: Array.from({ length: 101 }, () => ({ name: 'v1' })),
        }),
      ],
      ['bookinfo'],
      'svc.cluster.local'
    )
  ).toThrow('100 subsets');
});
it('requests the correct source families only with explicit DNS identity', () => {
  expect(
    referenceValidationSources('DestinationRule', 'networking.istio.io', spec, 'svc.cluster.local')
  ).toEqual(['namespaces', 'destinationRules', 'sidecars']);
  expect(
    referenceValidationSources('DestinationRule', 'networking.istio.io', { host: 'reviews' }, null)
  ).toEqual([]);
  expect(
    referenceValidationSources('DestinationRule', 'other.example.test', spec, 'svc.cluster.local')
  ).toEqual([]);
});
